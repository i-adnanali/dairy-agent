import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { EventType } from '@ag-ui/core';
import type { BaseEvent } from '@ag-ui/core';
import type { Approval } from '@dairy/shared';
import { ALL_TOOLS } from '../tools';
import { buildSystemPrompt } from './systemPrompt';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const FALLBACK_MODEL = 'claude-sonnet-4-5';
const MAX_TOKENS = 1500;

type AnyMessage = Anthropic.MessageParam;

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

/**
 * Stream one model turn, emitting AG-UI text events for each delta. Tool-call
 * blocks are recognised but not yet acted on (that arrives in phase 2); the
 * assembled final message is returned so the caller can decide what to do.
 */
async function streamModelTurn(
  model: string,
  system: string,
  messages: AnyMessage[],
  emit: Emit,
): Promise<Anthropic.Message> {
  const assistantMsgId = `msg_${randomUUID()}`;
  const blocks = new Map<number, { kind: 'text' | 'tool' }>();

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
        blocks.set(ev.index, { kind: 'tool' });
      }
    } else if (ev.type === 'content_block_delta') {
      const info = blocks.get(ev.index);
      if (ev.delta.type === 'text_delta' && info?.kind === 'text' && ev.delta.text) {
        emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: assistantMsgId,
          delta: ev.delta.text,
        } as BaseEvent);
      }
    } else if (ev.type === 'content_block_stop') {
      const info = blocks.get(ev.index);
      if (info?.kind === 'text') {
        emit({ type: EventType.TEXT_MESSAGE_END, messageId: assistantMsgId } as BaseEvent);
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

/**
 * Phase 1 skeleton: a single text-only turn streamed end to end as AG-UI
 * events. Tool calls are intentionally not handled yet.
 */
export async function runAgentStream({
  threadId,
  runId,
  messages,
  emit,
}: RunStreamArgs): Promise<void> {
  const system = buildSystemPrompt(todayISO());

  emit({ type: EventType.RUN_STARTED, threadId, runId } as BaseEvent);

  const finalMessage = await streamWithFallback(system, [...messages], emit);

  if (finalMessage.stop_reason === 'tool_use') {
    throw new Error('Tool calls are not supported yet (phase 1 skeleton).');
  }

  emit({ type: EventType.RUN_FINISHED, threadId, runId } as BaseEvent);
}
