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

  // NOTE: datasets are omitted here because Chart.js needs a real canvas
  // context (unavailable in jsdom). Chart data mapping is covered by
  // chart-card.spec.ts and rendering parity is verified in the Phase 5 QA pass.
  it('renders assistant markdown text and tool-call chips', () => {
    const item: TurnItem = {
      id: 'a1',
      role: 'assistant',
      text: 'Here is the **summary**.',
      toolCalls: [
        { toolUseId: 't1', name: 'get_milk_timeseries', status: 'done', argSummary: '{}' },
      ],
      datasets: [],
      agent: 'dairy',
    };
    const fixture = TestBed.createComponent(Message);
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Here is the summary.');
    // markdown renders bold as <strong>
    expect(el.querySelector('strong')?.textContent).toBe('summary');
    expect(el.querySelector('app-tool-call-chip')).toBeTruthy();
    // the per-turn agent tag (Cycle 2) renders the selected agent
    expect(el.textContent).toContain('dairy');
  });
});
