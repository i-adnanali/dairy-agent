import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
  viewChild,
} from '@angular/core';
import type { Approval, PendingWrite } from '@dairy/shared';
import { ChatStore } from '../core/chat-store';
import { Composer } from './composer';
import { ConfirmationCard } from './confirmation-card';
import { EmptyState } from './empty-state';
import { MessageList } from './message-list';

// Port of web-react/src/components/ChatPanel.tsx.
// Injects ChatStore directly instead of prop-drilling from the root.
@Component({
  selector: 'app-chat-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Composer, ConfirmationCard, EmptyState, MessageList],
  template: `
    <div class="mx-auto flex h-full max-w-3xl flex-col">
      <header class="border-b border-farm-200 bg-farm-50/80 px-6 py-4 backdrop-blur">
        <h1 class="text-lg font-semibold tracking-tight">Baghicha Dairy Co. — Farm Agent</h1>
        <p class="text-sm text-farm-600">
          Ask about your herd, milk, feed, and health, or your vendors, deliveries, and balances —
          and take actions with confirmation.
        </p>
      </header>

      <div #scrollEl class="flex-1 overflow-y-auto px-6 py-6">
        @if (store.isEmpty()) {
          <app-empty-state (pick)="store.send($event)" />
        } @else {
          <app-message-list [renderLog]="store.renderLog()" />
        }

        @if (store.loading()) {
          <div class="mt-4 flex items-center gap-2 text-sm text-farm-500">
            <span class="h-2 w-2 animate-pulse rounded-full bg-farm-400"></span>
            Thinking…
          </div>
        }

        @if (store.pending(); as pending) {
          @if (pending.length > 0) {
            <div class="mt-4 space-y-3">
              @for (card of pending; track card.toolUseId) {
                <app-confirmation-card [card]="card" (resolve)="store.resolve($event)" />
              }
              @if (pending.length > 1) {
                <button
                  class="rounded-md bg-farm-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-farm-700"
                  (click)="approveAll(pending)"
                >
                  Approve all ({{ pending.length }})
                </button>
              }
            </div>
          }
        }

        @if (store.error(); as error) {
          <div class="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {{ error }}
          </div>
        }
      </div>

      <app-composer [disabled]="store.busy()" (send)="store.send($event)" />
    </div>
  `,
})
export class ChatPanel {
  protected readonly store = inject(ChatStore);
  private readonly scrollEl = viewChild<ElementRef<HTMLDivElement>>('scrollEl');

  constructor() {
    // Replaces React's useRef + useEffect([renderLog, pending, loading]).
    // afterRenderEffect re-runs after the DOM is updated whenever the tracked
    // signals change, so scrollHeight reflects the newly rendered content.
    afterRenderEffect(() => {
      this.store.renderLog();
      this.store.pending();
      this.store.loading();
      const el = this.scrollEl()?.nativeElement;
      el?.scrollTo?.({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }

  protected approveAll(pending: PendingWrite[]): void {
    const approvals: Approval[] = pending.map((c) => ({
      toolUseId: c.toolUseId,
      approved: true,
    }));
    this.store.resolve(approvals);
  }
}
