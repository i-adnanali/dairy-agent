import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { ToolCallView } from '@dairy/shared';

// Port of web-react/src/components/ToolCallChip.tsx
@Component({
  selector: 'app-tool-call-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      (click)="open.set(!open())"
      class="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition"
      [class]="chipClass()"
      [title]="call().argSummary"
    >
      <span class="h-1.5 w-1.5 rounded-full" [class]="dotClass()"></span>
      <span class="font-medium">{{ call().name }}</span>
      <span class="opacity-70">{{ call().status }}</span>
      @if (open()) {
        <span class="ml-1 truncate font-mono opacity-80">{{ call().argSummary }}</span>
      }
    </button>
  `,
})
export class ToolCallChip {
  readonly call = input.required<ToolCallView>();

  protected readonly open = signal(false);
  protected readonly isError = computed(() => this.call().status === 'error');

  protected readonly chipClass = computed(() =>
    this.isError()
      ? 'border-red-300 bg-red-50 text-red-700'
      : 'border-farm-200 bg-farm-100 text-farm-700 hover:bg-farm-200',
  );

  protected readonly dotClass = computed(() =>
    this.isError() ? 'bg-red-500' : 'bg-emerald-500',
  );
}
