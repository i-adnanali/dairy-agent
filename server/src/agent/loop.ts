import Anthropic from '@anthropic-ai/sdk';
import type {
  Approval,
  ChatResponse,
  Dataset,
  PendingWrite,
  ToolCallView,
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

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const FALLBACK_MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 1500;
const MAX_ITERATIONS = 8;

type AnyMessage = Anthropic.MessageParam;
type ContentBlock = Anthropic.ContentBlock;
type ToolUse = Anthropic.ToolUseBlock;

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

/** Call the model, falling back to the latest Sonnet if the configured model
 * string is rejected. */
async function createMessage(
  system: string,
  messages: AnyMessage[],
): Promise<Anthropic.Message> {
  const anthropic = getClient();
  const body = {
    max_tokens: MAX_TOKENS,
    system,
    tools: ALL_TOOLS as unknown as Anthropic.Tool[],
    messages,
  };
  try {
    return await anthropic.messages.create({ model: DEFAULT_MODEL, ...body });
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status === 404 || status === 400) {
      // Likely an unknown model string -> retry once with the fallback.
      return await anthropic.messages.create({ model: FALLBACK_MODEL, ...body });
    }
    throw err;
  }
}

function argSummary(name: string, input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (Array.isArray(v)) parts.push(`${k}=[${v.length}]`);
    else if (v != null && typeof v === 'object') parts.push(`${k}={…}`);
    else parts.push(`${k}=${String(v)}`);
  }
  return `${name}(${parts.join(', ')})`;
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

function assistantText(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function toolUsesOf(content: ContentBlock[]): ToolUse[] {
  return content.filter((b): b is ToolUse => b.type === 'tool_use');
}

export async function runTurn(
  inputMessages: AnyMessage[],
  approvals: Approval[] = [],
): Promise<ChatResponse> {
  const system = buildSystemPrompt(todayISO());
  const messages: AnyMessage[] = [...inputMessages];
  const datasets: Dataset[] = [];
  const toolCalls: ToolCallView[] = [];
  let remainingApprovals = [...approvals];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const last = messages[messages.length - 1];
    let assistantTextOut = '';
    let toolUses: ToolUse[];

    const lastIsAssistantToolUse =
      last &&
      last.role === 'assistant' &&
      Array.isArray(last.content) &&
      toolUsesOf(last.content as ContentBlock[]).length > 0;

    if (lastIsAssistantToolUse) {
      // RESUMING after a confirmation pause.
      toolUses = toolUsesOf(last.content as ContentBlock[]);
    } else {
      const resp = await createMessage(system, messages);
      messages.push({ role: 'assistant', content: resp.content });
      assistantTextOut = assistantText(resp);
      if (resp.stop_reason !== 'tool_use') {
        return {
          messages: messages as never,
          render: { assistantText: assistantTextOut, toolCalls },
          datasets,
          done: true,
        };
      }
      toolUses = toolUsesOf(resp.content);
    }

    const reads = toolUses.filter((t) => READ_TOOL_NAMES.has(t.name));
    const writes = toolUses.filter((t) => WRITE_TOOL_NAMES.has(t.name));

    // --- Always (re)execute reads -- idempotent ---
    const readResults: Anthropic.ToolResultBlockParam[] = [];
    for (const r of reads) {
      const input = (r.input ?? {}) as Record<string, unknown>;
      const guardErr = guardIds(input);
      if (guardErr) {
        toolCalls.push({ toolUseId: r.id, name: r.name, status: 'error', argSummary: argSummary(r.name, input) });
        readResults.push(toolResultBlock(r.id, guardErr, true));
        continue;
      }
      const exec = READ_EXECUTORS[r.name];
      const { modelDigest, dataset } = exec(input);
      const errored = isToolError(modelDigest);
      if (dataset) datasets.push(dataset);
      console.log(`[loop] read ${r.name} -> model digest:`, JSON.stringify(modelDigest));
      toolCalls.push({ toolUseId: r.id, name: r.name, status: errored ? 'error' : 'done', argSummary: argSummary(r.name, input) });
      readResults.push(toolResultBlock(r.id, modelDigest, errored));
    }

    if (writes.length === 0) {
      messages.push({ role: 'user', content: readResults });
      continue; // let the model digest + answer
    }

    // --- There are writes -> need human approval ---
    const unresolved = writes.filter(
      (w) => !remainingApprovals.some((a) => a.toolUseId === w.id),
    );

    if (unresolved.length > 0) {
      const cards: PendingWrite[] = [];
      for (const w of writes) {
        const input = (w.input ?? {}) as Record<string, unknown>;
        toolCalls.push({ toolUseId: w.id, name: w.name, status: 'done', argSummary: argSummary(w.name, input) });
        cards.push(WRITE_EXECUTORS[w.name].buildCard(w.id, input));
      }
      return {
        messages: messages as never,
        render: { assistantText: assistantTextOut, toolCalls, pendingWrites: cards },
        datasets,
        done: false, // PAUSE -- client shows cards
      };
    }

    // --- All writes have an approval decision -> execute / decline ---
    const writeResults: Anthropic.ToolResultBlockParam[] = [];
    for (const w of writes) {
      const input = (w.input ?? {}) as Record<string, unknown>;
      const approved = remainingApprovals.find((a) => a.toolUseId === w.id)?.approved;
      if (approved) {
        const guardErr = guardIds(input);
        if (guardErr) {
          toolCalls.push({ toolUseId: w.id, name: w.name, status: 'error', argSummary: argSummary(w.name, input) });
          writeResults.push(toolResultBlock(w.id, guardErr, true));
          continue;
        }
        const res = WRITE_EXECUTORS[w.name].execute(input);
        toolCalls.push({ toolUseId: w.id, name: w.name, status: 'done', argSummary: argSummary(w.name, input) });
        writeResults.push(toolResultBlock(w.id, res));
      } else {
        toolCalls.push({ toolUseId: w.id, name: w.name, status: 'done', argSummary: argSummary(w.name, input) });
        writeResults.push(
          toolResultBlock(w.id, { declined: true, message: 'User declined this action.' }),
        );
      }
    }

    messages.push({ role: 'user', content: [...readResults, ...writeResults] });
    remainingApprovals = []; // consumed
  }

  // Iteration cap hit (principle #4).
  return {
    messages: messages as never,
    render: {
      assistantText:
        "This request got too involved for me to complete in one go. Could you narrow it down or break it into smaller steps?",
      toolCalls,
    },
    datasets,
    done: true,
  };
}
