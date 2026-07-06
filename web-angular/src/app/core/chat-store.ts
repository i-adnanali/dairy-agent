import { Injectable, computed, signal } from '@angular/core';
import type {
  AnthropicMessage,
  Approval,
  ChatResponse,
  PendingWrite,
} from '@dairy/shared';
import type { TurnItem } from './turn-item.type';

/**
 * Port of the state model in web-react/src/App.tsx.
 *
 * Deliberately NOT using resource()/rxResource(): send/resolve are imperative
 * "fire an action, react to its result" flows, not reactive GET-style reads.
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
  private nextId() {
    return `t_${++this.seq}`;
  }

  async send(text: string): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);
    const userMsg: AnthropicMessage = { role: 'user', content: text };
    const next = [...this.messages(), userMsg];
    this.messages.set(next);
    this.renderLog.update((log) => [
      ...log,
      { id: this.nextId(), role: 'user', text },
    ]);
    this.loading.set(true);
    try {
      this.applyResponse(await this.postChat(next));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      this.loading.set(false);
    }
  }

  async resolve(approvals: Approval[]): Promise<void> {
    this.error.set(null);
    this.pending.set(null);
    this.loading.set(true);
    try {
      // Resend the unchanged messages + approval decisions.
      this.applyResponse(await this.postChat(this.messages(), approvals));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      this.loading.set(false);
    }
  }

  private applyResponse(resp: ChatResponse): void {
    this.messages.set(resp.messages);
    const hasContent =
      resp.render.assistantText ||
      resp.render.toolCalls.length > 0 ||
      resp.datasets.length > 0;
    if (hasContent) {
      this.renderLog.update((log) => [
        ...log,
        {
          id: this.nextId(),
          role: 'assistant' as const,
          text: resp.render.assistantText,
          toolCalls: resp.render.toolCalls,
          datasets: resp.datasets,
        },
      ]);
    }
    this.pending.set(resp.render.pendingWrites ?? null);
  }

  private async postChat(
    messages: AnthropicMessage[],
    approvals?: Approval[],
  ): Promise<ChatResponse> {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, approvals }),
    });
    if (!res.ok) {
      let detail = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.message) detail = body.message;
      } catch {
        /* ignore */
      }
      throw new Error(detail);
    }
    return res.json();
  }
}
