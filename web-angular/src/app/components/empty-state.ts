import { ChangeDetectionStrategy, Component, output } from '@angular/core';

const STARTERS = [
  "How did the Kundi group's milk yield trend over the last 30 days?",
  'Which animals have a health event due in the next two weeks?',
  "Log this morning's milking for the Kundi group.",
];

// Port of web-react/src/components/EmptyState.tsx
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full flex-col items-center justify-center text-center">
      <div class="mb-2 text-4xl">🐃</div>
      <h2 class="text-xl font-semibold text-farm-800">Welcome to your farm assistant</h2>
      <p class="mb-6 mt-1 max-w-md text-sm text-farm-600">
        I can read your records to answer questions, and propose record changes that you approve before
        anything is written.
      </p>
      <div class="grid w-full max-w-md gap-2">
        @for (s of starters; track s) {
          <button
            (click)="pick.emit(s)"
            class="rounded-xl border border-farm-200 bg-white px-4 py-3 text-left text-sm text-farm-800 shadow-sm transition hover:border-farm-400 hover:bg-farm-100"
          >
            {{ s }}
          </button>
        }
      </div>
    </div>
  `,
})
export class EmptyState {
  readonly pick = output<string>();
  protected readonly starters = STARTERS;
}
