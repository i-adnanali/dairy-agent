import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TurnItem } from '../core/turn-item.type';
import { ToolCallChip } from './tool-call-chip';

// Port of web-react/src/components/Message.tsx
// NOTE: assistant text is rendered as plain text here; markdown (ngx-markdown +
// DOMPurify) and the ChartCard slot are wired in Phase 3.
@Component({
  selector: 'app-message',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ToolCallChip],
  template: `
    @if (item().role === 'user') {
      <div class="flex justify-end">
        <div
          class="max-w-[80%] rounded-2xl rounded-br-sm bg-farm-600 px-4 py-2.5 text-sm text-white shadow-sm"
        >
          {{ item().text }}
        </div>
      </div>
    } @else if (assistant(); as a) {
      <div class="flex flex-col items-start gap-2">
        @if (a.text) {
          <div
            class="prose-chat max-w-[85%] rounded-2xl rounded-bl-sm border border-farm-200 bg-white px-4 py-3 text-sm text-farm-900 shadow-sm"
          >
            {{ a.text }}
          </div>
        }

        @if (a.toolCalls.length > 0) {
          <div class="flex flex-wrap gap-1.5">
            @for (tc of a.toolCalls; track tc.toolUseId) {
              <app-tool-call-chip [call]="tc" />
            }
          </div>
        }

        @if (a.datasets.length > 0) {
          <div class="w-full space-y-3">
            @for (ds of a.datasets; track ds.datasetId) {
              <!-- ChartCard wired in Phase 3 -->
              <div class="rounded-xl border border-farm-200 bg-white p-4 text-xs text-farm-500">
                {{ ds.scopeLabel }} — {{ ds.interval }}ly yield ({{ ds.points.length }} points)
              </div>
            }
          </div>
        }
      </div>
    }
  `,
})
export class Message {
  readonly item = input.required<TurnItem>();

  protected readonly assistant = computed(() => {
    const it = this.item();
    return it.role === 'assistant' ? it : null;
  });
}
