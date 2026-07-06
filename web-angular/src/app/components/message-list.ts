import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { TurnItem } from '../core/turn-item.type';
import { Message } from './message';

// Port of web-react/src/components/MessageList.tsx
@Component({
  selector: 'app-message-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Message],
  template: `
    <div class="space-y-5">
      @for (item of renderLog(); track item.id) {
        <app-message [item]="item" />
      }
    </div>
  `,
})
export class MessageList {
  readonly renderLog = input.required<TurnItem[]>();
}
