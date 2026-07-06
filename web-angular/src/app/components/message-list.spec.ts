import { TestBed } from '@angular/core/testing';
import type { TurnItem } from '../core/turn-item.type';
import { MessageList } from './message-list';

describe('MessageList', () => {
  it('renders one app-message per render-log item', () => {
    const log: TurnItem[] = [
      { id: 'u1', role: 'user', text: 'hi' },
      { id: 'a1', role: 'assistant', text: 'hello', toolCalls: [], datasets: [] },
    ];
    const fixture = TestBed.createComponent(MessageList);
    fixture.componentRef.setInput('renderLog', log);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('app-message'),
    ).toHaveLength(2);
  });
});
