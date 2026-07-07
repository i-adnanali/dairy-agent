import { Injectable, computed, signal } from '@angular/core';
import { HttpAgent } from '@ag-ui/client';
import { EventType } from '@ag-ui/core';
import type { BaseEvent } from '@ag-ui/core';
import type {
  AgentRunForwardedProps,
  AnthropicMessage,
  Approval,
  Dataset,
  PendingWrite,
  ToolCallView,
} from '@dairy/shared';
import {
  DAIRY_DATASET_EVENT,
  DAIRY_MESSAGES_EVENT,
  DAIRY_PENDING_EVENT,
} from '@dairy/shared';
import type { TurnItem } from './turn-item.type';

/**
 * State model for the AG-UI streaming contract (POST /api/agent/run).
 *
 * The five signals mirror the previous REST store, but instead of being set
 * from one JSON response they are driven incrementally by AG-UI events streamed
 * from an @ag-ui/client HttpAgent. The opaque Anthropic history and approval
 * decisions travel to the server via the run input's forwardedProps; the server
 * streams back text/tool events plus the dairy.* CUSTOM side-channels.
 */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  readonly messages = signal<AnthropicMessage[]>([]);
  readonly renderLog = signal<TurnItem[]>([]);
  readonly pending = signal<PendingWrite[] | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly busy = computed(() => this.loading() || this.pending() !== null);
  readonly isEmpty = computed(() => this.renderLog().length === 0);

  private seq = 0;
  private nextId(): string {
    return `t_${++this.seq}`;
  }

  private readonly agent = new HttpAgent({ url: '/api/agent/run' });

  // Per-run streaming state.
  private currentAssistantId: string | null = null;
  private readonly argsBuffer = new Map<string, string>();
  private readonly toolNames = new Map<string, string>();

  async send(text: string): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);
    const userMsg: AnthropicMessage = { role: 'user', content: text };
    const next = [...this.messages(), userMsg];
    this.messages.set(next);
    this.renderLog.update((log) => [...log, { id: this.nextId(), role: 'user', text }]);
    await this.runAgent(next);
  }

  async resolve(approvals: Approval[]): Promise<void> {
    this.error.set(null);
    this.pending.set(null);
    // Resume with a fresh run: resend the unchanged history + approval decisions.
    await this.runAgent(this.messages(), approvals);
  }

  private async runAgent(messages: AnthropicMessage[], approvals?: Approval[]): Promise<void> {
    this.loading.set(true);
    this.currentAssistantId = null;
    this.argsBuffer.clear();
    this.toolNames.clear();
    const forwardedProps: AgentRunForwardedProps = { messages, approvals };
    try {
      await this.agent.runAgent(
        { forwardedProps },
        { onEvent: ({ event }) => this.handleEvent(event) },
      );
    } catch (e) {
      if (!this.error()) {
        this.error.set(e instanceof Error ? e.message : 'Something went wrong.');
      }
    } finally {
      this.loading.set(false);
    }
  }

  // --- event handling ------------------------------------------------------

  private handleEvent(event: BaseEvent): void {
    switch (event.type) {
      case EventType.RUN_STARTED:
        this.currentAssistantId = null;
        this.argsBuffer.clear();
        this.toolNames.clear();
        break;
      case EventType.TEXT_MESSAGE_START:
        this.ensureAssistant();
        this.updateCurrent((a) => (a.text ? { ...a, text: a.text + '\n\n' } : a));
        break;
      case EventType.TEXT_MESSAGE_CONTENT: {
        const delta = readString(event, 'delta');
        if (delta) {
          this.ensureAssistant();
          this.updateCurrent((a) => ({ ...a, text: a.text + delta }));
        }
        break;
      }
      case EventType.TOOL_CALL_START: {
        const id = readString(event, 'toolCallId');
        const name = readString(event, 'toolCallName');
        if (id) this.addToolCall(id, name);
        break;
      }
      case EventType.TOOL_CALL_ARGS: {
        const id = readString(event, 'toolCallId');
        const delta = readString(event, 'delta');
        if (id) this.argsBuffer.set(id, (this.argsBuffer.get(id) ?? '') + delta);
        break;
      }
      case EventType.TOOL_CALL_END: {
        const id = readString(event, 'toolCallId');
        if (id) this.finalizeToolArgs(id);
        break;
      }
      case EventType.TOOL_CALL_RESULT: {
        const id = readString(event, 'toolCallId');
        if (id) this.markToolResult(id, readString(event, 'content'));
        break;
      }
      case EventType.CUSTOM: {
        const name = readString(event, 'name');
        const value = (event as unknown as { value?: unknown }).value;
        if (name === DAIRY_DATASET_EVENT && value) this.addDataset(value as Dataset);
        else if (name === DAIRY_MESSAGES_EVENT && Array.isArray(value)) {
          this.messages.set(value as AnthropicMessage[]);
        } else if (name === DAIRY_PENDING_EVENT && Array.isArray(value)) {
          this.pending.set(value as PendingWrite[]);
        }
        break;
      }
      case EventType.RUN_ERROR:
        this.error.set(readString(event, 'message') || 'Something went wrong.');
        break;
      default:
        break;
    }
  }

  // --- render-log mutation helpers ----------------------------------------

  private ensureAssistant(): void {
    if (this.currentAssistantId) return;
    const id = this.nextId();
    this.currentAssistantId = id;
    this.renderLog.update((log) => [
      ...log,
      { id, role: 'assistant', text: '', toolCalls: [], datasets: [] },
    ]);
  }

  /** Update the current in-progress assistant turn. */
  private updateCurrent(fn: (a: AssistantItem) => AssistantItem): void {
    const id = this.currentAssistantId;
    if (!id) return;
    this.renderLog.update((log) =>
      log.map((it) => (it.id === id && it.role === 'assistant' ? fn(it) : it)),
    );
  }

  private addToolCall(toolCallId: string, name: string): void {
    this.ensureAssistant();
    this.toolNames.set(toolCallId, name);
    const call: ToolCallView = { toolUseId: toolCallId, name, status: 'done', argSummary: name };
    this.updateCurrent((a) => ({ ...a, toolCalls: [...a.toolCalls, call] }));
  }

  private finalizeToolArgs(toolCallId: string): void {
    const name = this.toolNames.get(toolCallId) ?? '';
    const raw = this.argsBuffer.get(toolCallId) ?? '';
    let input: Record<string, unknown> = {};
    try {
      if (raw) input = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      /* partial/unparseable args - fall back to the bare name */
    }
    this.patchToolCall(toolCallId, (c) => ({ ...c, argSummary: argSummary(name, input) }));
  }

  private markToolResult(toolCallId: string, content: string): void {
    let errored = false;
    try {
      const parsed = content ? (JSON.parse(content) as Record<string, unknown>) : {};
      errored = typeof parsed['error'] === 'string';
    } catch {
      /* non-JSON result - treat as success */
    }
    if (errored) this.patchToolCall(toolCallId, (c) => ({ ...c, status: 'error' }));
  }

  /** Patch a tool-call chip anywhere in the log (results may land in a later
   * resume run than the run that opened the call). */
  private patchToolCall(toolUseId: string, fn: (c: ToolCallView) => ToolCallView): void {
    this.renderLog.update((log) =>
      log.map((it) => {
        if (it.role !== 'assistant') return it;
        if (!it.toolCalls.some((c) => c.toolUseId === toolUseId)) return it;
        return {
          ...it,
          toolCalls: it.toolCalls.map((c) => (c.toolUseId === toolUseId ? fn(c) : c)),
        };
      }),
    );
  }

  private addDataset(dataset: Dataset): void {
    this.ensureAssistant();
    this.updateCurrent((a) => ({ ...a, datasets: [...a.datasets, dataset] }));
  }
}

type AssistantItem = Extract<TurnItem, { role: 'assistant' }>;

function readString(event: BaseEvent, key: string): string {
  const v = (event as unknown as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
}

/** Mirrors the server's argSummary so chips read identically to the old contract. */
function argSummary(name: string, input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (Array.isArray(v)) parts.push(`${k}=[${v.length}]`);
    else if (v != null && typeof v === 'object') parts.push(`${k}={…}`);
    else parts.push(`${k}=${String(v)}`);
  }
  return `${name}(${parts.join(', ')})`;
}
