import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { EventType } from '@ag-ui/core';
import type { BaseEvent } from '@ag-ui/core';
import type { Approval, Dataset } from '@dairy/shared';
import { DAIRY_DATASET_EVENT, DAIRY_MESSAGES_EVENT } from '@dairy/shared';
import {
  ALL_TOOLS,
  READ_EXECUTORS,
  READ_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  guardIds,
} from '../tools';
import { isToolError } from '../tools/reads';
import { buildSystemPrompt } from './systemPrompt';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const FALLBACK_MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 1500;
const MAX_ITERATIONS = 8;

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

  return await stream.finalMessage();
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
function runReads(
  emit: Emit,
  reads: ToolUse[],
  emitUi: boolean,
): Anthropic.ToolResultBlockParam[] {
  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const r of reads) {
    const input = (r.input ?? {}) as Record<string, unknown>;
    const guardErr = guardIds(input);
    if (guardErr) {
      if (emitUi) emitToolResult(emit, r.id, guardErr);
      results.push(toolResultBlock(r.id, guardErr, true));
      continue;
    }
    const { modelDigest, dataset } = READ_EXECUTORS[r.name](input);
    const errored = isToolError(modelDigest);
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
  }
  return results;
}

/**
 * Phase 2: text + read tools streamed as AG-UI events, looping up to
 * MAX_ITERATIONS. Write tools are not handled yet (phase 3).
 */
export async function runAgentStream({
  threadId,
  runId,
  messages,
  emit,
}: RunStreamArgs): Promise<void> {
  const system = buildSystemPrompt(todayISO());
  const msgs: AnyMessage[] = [...messages];

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

    const readResults = runReads(emit, reads, !lastIsAssistantToolUse);

    if (writes.length === 0) {
      msgs.push({ role: 'user', content: readResults });
      emit({ type: EventType.STEP_FINISHED, stepName } as BaseEvent);
      continue;
    }

    // Writes require human approval - implemented in phase 3.
    throw new Error('Write tools are not supported yet (phase 3).');
  }

  // Iteration cap - refined into a graceful, friendly finish in phase 4.
  emitHistory(emit, msgs);
  emit({
    type: EventType.RUN_FINISHED,
    threadId,
    runId,
    outcome: { type: 'success' },
  } as BaseEvent);
}
