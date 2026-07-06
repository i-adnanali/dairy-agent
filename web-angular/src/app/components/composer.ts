import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

// Port of web-react/src/components/Composer.tsx
@Component({
  selector: 'app-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border-t border-farm-200 bg-farm-50 px-6 py-4">
      <div class="flex items-end gap-2">
        <textarea
          [value]="value()"
          (input)="value.set($any($event.target).value)"
          (keydown)="onKeydown($event)"
          [disabled]="disabled()"
          rows="1"
          [placeholder]="placeholder()"
          class="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-farm-300 bg-white px-3 py-2.5 text-sm text-farm-900 outline-none focus:border-farm-500 disabled:bg-farm-100 disabled:text-farm-400"
        ></textarea>
        <button
          (click)="submit()"
          [disabled]="disabled() || !value().trim()"
          class="rounded-xl bg-farm-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-farm-700 disabled:cursor-not-allowed disabled:bg-farm-300"
        >
          Send
        </button>
      </div>
    </div>
  `,
})
export class Composer {
  readonly disabled = input(false);
  readonly send = output<string>();

  protected readonly value = signal('');

  protected readonly placeholder = computed(() =>
    this.disabled()
      ? 'Resolve the pending action above to continue…'
      : 'Ask about the herd, or request an action…',
  );

  protected submit(): void {
    const text = this.value().trim();
    if (!text || this.disabled()) return;
    this.send.emit(text);
    this.value.set('');
  }

  protected onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.submit();
    }
  }
}
