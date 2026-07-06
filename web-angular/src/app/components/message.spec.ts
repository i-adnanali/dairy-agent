import { TestBed } from '@angular/core/testing';
import type { TurnItem } from '../core/turn-item.type';
import { Message } from './message';

describe('Message', () => {
  it('renders a right-aligned bubble for user turns', () => {
    const item: TurnItem = { id: 'u1', role: 'user', text: 'How is the herd?' };
    const fixture = TestBed.createComponent(Message);
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('How is the herd?');
    expect(el.querySelector('.justify-end')).toBeTruthy();
  });

  it('renders assistant text, tool-call chips and dataset slots', () => {
    const item: TurnItem = {
      id: 'a1',
      role: 'assistant',
      text: 'Here is the summary.',
      toolCalls: [
        { toolUseId: 't1', name: 'get_milk_timeseries', status: 'done', argSummary: '{}' },
      ],
      datasets: [
        {
          datasetId: 'd1',
          kind: 'timeseries',
          scopeLabel: 'Kundi group',
          interval: 'day',
          points: [{ periodStart: '2026-07-01', totalLitres: 100, avgPerAnimal: 5 }],
        },
      ],
    };
    const fixture = TestBed.createComponent(Message);
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Here is the summary.');
    expect(el.querySelector('app-tool-call-chip')).toBeTruthy();
    expect(el.textContent).toContain('Kundi group');
  });
});
