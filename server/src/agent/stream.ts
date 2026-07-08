import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { EventType } from '@ag-ui/core';
import type { BaseEvent } from '@ag-ui/core';
import type { Approval, Dataset, PendingWrite } from '@dairy/shared';
import {
  DAIRY_DATASET_EVENT,
  DAIRY_MESSAGES_EVENT,
  DAIRY_PENDING_EVENT,
} from '@dairy/shared';
import {
  ALL_TOOLS,
  READ_EXECUTORS,
  READ_TOOL_NAMES,
  WRITE_EXECUTORS,
  WRITE_TOOL_NAMES,
  guardIds,
} from '../tools';
import { isToolError } from '../tools/reads';
import { buildSystemPrompt } from './systemPrompt';
import {
  startActiveObservation,
  startObservation,
  updateActiveObservation,
} from '@langfuse/tracing';
import { setTraceMetadata, setTraceName, setTraceSession } from './tracing';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const FALLBACK_MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 1500;
// Matches loop.ts (8); overridable only to make the cap path testable.
const MAX_ITERATIONS = Number(process.env.AGENT_MAX_ITERATIONS) || 8;

const ITERATION_CAP_MESSAGE =
  'This request got too involved for me to complete in one go. Could you narrow it down or break it into smaller steps?';

type AnyMessage = Anthropic.MessageParam;
type ContentBlock = Anthropic.ContentBlock;
type ToolUse = Anthropic.ToolUseBlock;

/** Sink for AG-UI events; the route wires this to the SSE response. */
export type Emit = (event: BaseEvent) => void;

export interface RunStreamArgs {
  threadId: string;
  runId: string;
  messages: AnyMessage[];
  approvals?: Approval[];
  emit: Emit;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function toolResultBlock(
  toolUseId: string,
  content: unknown,
  isError = false,
): Anthropic.ToolResultBlockParam {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    content: JSON.stringify(content),
    is_error: isError,
  };
}

function toolUsesOf(content: ContentBlock[]): ToolUse[] {
  return content.filter((b): b is ToolUse => b.type === 'tool_use');
}

/** Emit the full opaque history so the client can store and resend it next turn
 * (Decision 2 - the server stays stateless). */
function emitHistory(emit: Emit, messages: AnyMessage[]): void {
  emit({ type: EventType.CUSTOM, name: DAIRY_MESSAGES_EVENT, value: messages } as BaseEvent);
}

/**
 * Stream one model turn, emitting AG-UI text and tool-call events for each
 * delta. Returns the assembled final message so the caller can execute tools.
 */
async function streamModelTurn(
  model: string,
  system: string,
  messages: AnyMessage[],
  emit: Emit,
): Promise<Anthropic.Message> {
  const assistantMsgId = `msg_${randomUUID()}`;
  const blocks = new Map<number, { kind: 'text' | 'tool'; toolCallId?: string }>();

  // One Langfuse generation per actual model call; a fallback attempt calls this
  // again and so shows up as its own generation. Token counts come from the
  // Anthropic response so Langfuse infers cost from the model with no pricing table.
  const generation = startObservation(
    'anthropic-messages',
    { model, input: messages },
    { asType: 'generation' },
  );

  try {
    const stream = getClient().messages.stream({
      model,
      max_tokens: MAX_TOKENS,
      system,
      tools: ALL_TOOLS as unknown as Anthropic.Tool[],
      messages,
    });

    for await (const ev of stream) {
      if (ev.type === 'content_block_start') {
        if (ev.content_block.type === 'text') {
          blocks.set(ev.index, { kind: 'text' });
          emit({
            type: EventType.TEXT_MESSAGE_START,
            messageId: assistantMsgId,
            role: 'assistant',
          } as BaseEvent);
        } else if (ev.content_block.type === 'tool_use') {
          blocks.set(ev.index, { kind: 'tool', toolCallId: ev.content_block.id });
          emit({
            type: EventType.TOOL_CALL_START,
            toolCallId: ev.content_block.id,
            toolCallName: ev.content_block.name,
            parentMessageId: assistantMsgId,
          } as BaseEvent);
        }
      } else if (ev.type === 'content_block_delta') {
        const info = blocks.get(ev.index);
        if (ev.delta.type === 'text_delta' && info?.kind === 'text' && ev.delta.text) {
          emit({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: assistantMsgId,
            delta: ev.delta.text,
          } as BaseEvent);
        } else if (
          ev.delta.type === 'input_json_delta' &&
          info?.kind === 'tool' &&
          ev.delta.partial_json
        ) {
          emit({
            type: EventType.TOOL_CALL_ARGS,
            toolCallId: info.toolCallId,
            delta: ev.delta.partial_json,
          } as BaseEvent);
        }
      } else if (ev.type === 'content_block_stop') {
        const info = blocks.get(ev.index);
        if (info?.kind === 'text') {
          emit({ type: EventType.TEXT_MESSAGE_END, messageId: assistantMsgId } as BaseEvent);
        } else if (info?.kind === 'tool') {
          emit({ type: EventType.TOOL_CALL_END, toolCallId: info.toolCallId } as BaseEvent);
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    const usage = finalMessage.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number | null;
      cache_creation_input_tokens?: number | null;
    };
    generation
      .update({
        model,
        output: finalMessage.content,
        usageDetails: {
          input: usage.input_tokens,
          output: usage.output_tokens,
          ...(usage.cache_read_input_tokens != null
            ? { cache_read_input_tokens: usage.cache_read_input_tokens }
            : {}),
          ...(usage.cache_creation_input_tokens != null
            ? { cache_creation_input_tokens: usage.cache_creation_input_tokens }
            : {}),
        },
        metadata: { stopReason: finalMessage.stop_reason ?? 'unknown' },
      })
      .end();
    return finalMessage;
  } catch (err: unknown) {
    generation
      .update({
        level: 'ERROR',
        statusMessage: err instanceof Error ? err.message : String(err),
      })
      .end();
    throw err;
  }
}

/** Call the model, falling back to the latest Sonnet if the configured model
 * string is rejected (mirrors loop.ts). Only falls back if nothing has been
 * emitted yet, so a mid-stream failure never double-emits. */
async function streamWithFallback(
  system: string,
  messages: AnyMessage[],
  emit: Emit,
): Promise<Anthropic.Message> {
  let emitted = 0;
  const counting: Emit = (e) => {
    emitted++;
    emit(e);
  };
  try {
    return await streamModelTurn(DEFAULT_MODEL, system, messages, counting);
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if ((status === 404 || status === 400) && emitted === 0) {
      return await streamModelTurn(FALLBACK_MODEL, system, messages, emit);
    }
    throw err;
  }
}

/** Emit a TOOL_CALL_RESULT carrying a read/write digest for the model. */
function emitToolResult(emit: Emit, toolCallId: string, content: unknown): void {
  emit({
    type: EventType.TOOL_CALL_RESULT,
    messageId: `msg_${randomUUID()}`,
    toolCallId,
    content: JSON.stringify(content),
    role: 'tool',
  } as BaseEvent);
}

/**
 * Execute all read tools in a turn, emitting a TOOL_CALL_RESULT per read plus a
 * CUSTOM dairy.dataset event when a chart dataset is present (Decision 1). The
 * tool_result blocks (carrying the model digest) are returned to append to the
 * conversation. When `emitUi` is false (a resume turn), the read events were
 * already emitted in the prior run, so we re-execute silently for the model
 * only.
 */
/** What runReads reports back to the loop: the tool_result blocks plus stats fed
 * into the trace's custom `digest_size` / `dataset_rows` attributes. */
interface ReadRunResult {
  results: Anthropic.ToolResultBlockParam[];
  digestBytes: number;
  datasetRows: number;
}

function runReads(emit: Emit, reads: ToolUse[], emitUi: boolean): ReadRunResult {
  const results: Anthropic.ToolResultBlockParam[] = [];
  let digestBytes = 0;
  let datasetRows = 0;

  for (const r of reads) {
    const input = (r.input ?? {}) as Record<string, unknown>;
    const tool = startObservation(r.name, { input }, { asType: 'tool' });

    const guardErr = guardIds(input);
    if (guardErr) {
      if (emitUi) emitToolResult(emit, r.id, guardErr);
      results.push(toolResultBlock(r.id, guardErr, true));
      tool
        .update({
          output: guardErr,
          level: 'WARNING',
          metadata: { toolUseId: r.id, kind: 'read', guardRejected: true },
        })
        .end();
      continue;
    }

    const { modelDigest, dataset } = READ_EXECUTORS[r.name](input);
    const errored = isToolError(modelDigest);
    const bytes = JSON.stringify(modelDigest ?? null).length;
    const rows = dataset?.points.length ?? 0;
    digestBytes += bytes;
    datasetRows += rows;

    if (emitUi) {
      emitToolResult(emit, r.id, modelDigest);
      if (dataset) {
        emit({
          type: EventType.CUSTOM,
          name: DAIRY_DATASET_EVENT,
          value: dataset satisfies Dataset,
        } as BaseEvent);
      }
    }
    results.push(toolResultBlock(r.id, modelDigest, errored));
    tool
      .update({
        output: modelDigest,
        ...(errored ? { level: 'WARNING' as const } : {}),
        metadata: {
          toolUseId: r.id,
          kind: 'read',
          isError: errored,
          digestBytes: bytes,
          datasetRows: rows,
          replay: !emitUi,
        },
      })
      .end();
  }

  return { results, digestBytes, datasetRows };
}

type FinishReason = 'completed' | 'awaiting_approval' | 'iteration_cap';

/** Best-effort plain-text of the most recent user message, for the trace input. */
function latestUserText(messages: AnyMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const text = (m.content as ContentBlock[])
      .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (text) return text;
  }
  return '';
}

/** Concatenated assistant text blocks, for the trace output. */
function assistantTextOf(content: ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Text + read tools + write approval, streamed as AG-UI events, looping up to
 * MAX_ITERATIONS. Writes pause the run with a RUN_FINISHED interrupt outcome
 * (Decision 2); the client resumes with a fresh run carrying approvals.
 *
 * Wrapped in a Langfuse root observation so the whole turn is one trace, grouped
 * by session (threadId) so a pause and its resume share a session.
 */
export async function runAgentStream(args: RunStreamArgs): Promise<void> {
  await startActiveObservation('agent-run', () => runAgentStreamTraced(args), {
    asType: 'agent',
  });
}

async function runAgentStreamTraced({
  threadId,
  runId,
  messages,
  approvals,
  emit,
}: RunStreamArgs): Promise<void> {
  const system = buildSystemPrompt(todayISO());
  const msgs: AnyMessage[] = [...messages];
  let remainingApprovals = [...(approvals ?? [])];

  // Trace-level attributes. threadId is the Langfuse session key so a pause and
  // its resume (a new run on the same threadId) land in one session. The custom
  // digest/dataset totals are accumulated across iterations and written at the
  // exit that is actually taken, alongside finish_reason.
  setTraceSession(threadId);
  setTraceName('agent-run');
  updateActiveObservation({ input: latestUserText(msgs) });
  let totalDigestBytes = 0;
  let totalDatasetRows = 0;
  const finalize = (finishReason: FinishReason, output?: unknown): void => {
    setTraceMetadata({
      finish_reason: finishReason,
      digest_size: totalDigestBytes,
      dataset_rows: totalDatasetRows,
    });
    if (output !== undefined) updateActiveObservation({ output });
  };

  emit({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const stepName = `iteration-${iteration + 1}`;
    emit({ type: EventType.STEP_STARTED, stepName } as BaseEvent);

    const last = msgs[msgs.length - 1];
    const lastIsAssistantToolUse =
      !!last &&
      last.role === 'assistant' &&
      Array.isArray(last.content) &&
      toolUsesOf(last.content as ContentBlock[]).length > 0;

    let toolUses: ToolUse[];
    if (lastIsAssistantToolUse) {
      toolUses = toolUsesOf(last.content as ContentBlock[]);
    } else {
      const finalMessage = await streamWithFallback(system, msgs, emit);
      msgs.push({ role: 'assistant', content: finalMessage.content });
      if (finalMessage.stop_reason !== 'tool_use') {
        emit({ type: EventType.STEP_FINISHED, stepName } as BaseEvent);
        emitHistory(emit, msgs);
        finalize('completed', assistantTextOf(finalMessage.content));
        emit({
          type: EventType.RUN_FINISHED,
          threadId,
          runId,
          outcome: { type: 'success' },
        } as BaseEvent);
        return;
      }
      toolUses = toolUsesOf(finalMessage.content);
    }

    const reads = toolUses.filter((t) => READ_TOOL_NAMES.has(t.name));
    const writes = toolUses.filter((t) => WRITE_TOOL_NAMES.has(t.name));

    const readRun = runReads(emit, reads, !lastIsAssistantToolUse);
    const readResults = readRun.results;
    totalDigestBytes += readRun.digestBytes;
    totalDatasetRows += readRun.datasetRows;

    if (writes.length === 0) {
      msgs.push({ role: 'user', content: readResults });
      emit({ type: EventType.STEP_FINISHED, stepName } as BaseEvent);
      continue;
    }

    // --- There are writes -> need human approval ---
    const unresolved = writes.filter(
      (w) => !remainingApprovals.some((a) => a.toolUseId === w.id),
    );

    if (unresolved.length > 0) {
      const cards: PendingWrite[] = writes.map((w) =>
        WRITE_EXECUTORS[w.name].buildCard(w.id, (w.input ?? {}) as Record<string, unknown>),
      );
      emit({ type: EventType.STEP_FINISHED, stepName } as BaseEvent);
      // Persist history so the client can resend the assistant tool_use turn,
      // then pause for approval (Decision 2). The pending cards travel over a
      // CUSTOM dairy.pending event and the run ends with a plain RUN_FINISHED.
      //
      // NOTE: we deliberately do NOT use RUN_FINISHED { outcome: interrupt }.
      // @ag-ui/client tracks that as an open interrupt and then rejects the
      // next run unless it carries a standard resume[] addressing the interrupt
      // id ("Thread has N pending interrupt(s) not addressed by resume"). That
      // conflicts with our stateless forwardedProps.approvals resume. Signalling
      // the pause via CUSTOM keeps the client's interrupt state machine out of
      // the loop. (Phase-0 Decision 2 assumed the interrupt outcome was free
      // belt-and-suspenders; in practice it fights the client - see
      // docs/AGUI_MIGRATION.md.)
      emitHistory(emit, msgs);
      emit({ type: EventType.CUSTOM, name: DAIRY_PENDING_EVENT, value: cards } as BaseEvent);
      finalize('awaiting_approval', { pendingWrites: cards.length });
      emit({
        type: EventType.RUN_FINISHED,
        threadId,
        runId,
        outcome: { type: 'success' },
      } as BaseEvent);
      return;
    }

    // --- All writes have an approval decision -> execute / decline ---
    const writeResults: Anthropic.ToolResultBlockParam[] = [];
    for (const w of writes) {
      const input = (w.input ?? {}) as Record<string, unknown>;
      const approved = remainingApprovals.find((a) => a.toolUseId === w.id)?.approved;
      const tool = startObservation(w.name, { input }, { asType: 'tool' });
      if (approved) {
        const guardErr = guardIds(input);
        if (guardErr) {
          emitToolResult(emit, w.id, guardErr);
          writeResults.push(toolResultBlock(w.id, guardErr, true));
          tool
            .update({
              output: guardErr,
              level: 'WARNING',
              metadata: { toolUseId: w.id, kind: 'write', approved: true, guardRejected: true },
            })
            .end();
          continue;
        }
        const res = WRITE_EXECUTORS[w.name].execute(input);
        emitToolResult(emit, w.id, res);
        writeResults.push(toolResultBlock(w.id, res));
        tool
          .update({
            output: res,
            metadata: { toolUseId: w.id, kind: 'write', approved: true },
          })
          .end();
      } else {
        const declined = { declined: true, message: 'User declined this action.' };
        emitToolResult(emit, w.id, declined);
        writeResults.push(toolResultBlock(w.id, declined));
        tool
          .update({
            output: declined,
            metadata: { toolUseId: w.id, kind: 'write', approved: false, declined: true },
          })
          .end();
      }
    }

    msgs.push({ role: 'user', content: [...readResults, ...writeResults] });
    remainingApprovals = []; // consumed
    emit({ type: EventType.STEP_FINISHED, stepName } as BaseEvent);
  }

  // Iteration cap hit: a graceful, friendly finish - NOT an error (Decision 3).
  // Stream the friendly text as a normal assistant message so the frontend
  // treats it as a completion, not a failure state.
  const capMsgId = `msg_${randomUUID()}`;
  emit({ type: EventType.TEXT_MESSAGE_START, messageId: capMsgId, role: 'assistant' } as BaseEvent);
  emit({
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: capMsgId,
    delta: ITERATION_CAP_MESSAGE,
  } as BaseEvent);
  emit({ type: EventType.TEXT_MESSAGE_END, messageId: capMsgId } as BaseEvent);
  msgs.push({ role: 'assistant', content: ITERATION_CAP_MESSAGE });
  emitHistory(emit, msgs);
  finalize('iteration_cap', ITERATION_CAP_MESSAGE);
  emit({
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
    outcome: { type: 'success' },
  } as BaseEvent);
}
