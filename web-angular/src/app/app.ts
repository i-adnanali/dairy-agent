import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ChatPanel } from './components/chat-panel';

// Thin root shell, mirrors web-react/src/App.tsx's final JSX.
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatPanel],
  template: `
    <div class="h-full bg-farm-50 text-farm-900">
      <app-chat-panel />
    </div>
  `,
})
export class App {}
