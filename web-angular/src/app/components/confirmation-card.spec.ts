import { TestBed } from '@angular/core/testing';
import type { Approval, PendingWrite } from '@dairy/shared';
import { ConfirmationCard } from './confirmation-card';

const cardWithRows: PendingWrite = {
  toolUseId: 'w1',
  toolName: 'log_milking',
  summary: 'Log morning milking for Kundi group',
  details: [
    { label: 'Session', value: 'morning' },
    { label: 'Date', value: '2026-07-06' },
  ],
  rows: [
    { tag: 'K-01', name: 'Laali', value: '6.2 L' },
    { tag: 'K-02', value: '5.8 L' },
  ],
};

describe('ConfirmationCard', () => {
  function mount(card: PendingWrite) {
    const fixture = TestBed.createComponent(ConfirmationCard);
    fixture.componentRef.setInput('card', card);
    fixture.detectChanges();
    return fixture;
  }

  it('renders summary, tool name, details and the optional rows table', () => {
    const fixture = mount(cardWithRows);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('log_milking');
    expect(text).toContain('Log morning milking for Kundi group');
    expect(text).toContain('Session');
    expect(text).toContain('morning');
    expect(text).toContain('K-01 · Laali');
    expect(text).toContain('6.2 L');
    expect((fixture.nativeElement as HTMLElement).querySelector('table')).toBeTruthy();
  });

  it('omits the table when there are no rows', () => {
    const fixture = mount({ ...cardWithRows, rows: undefined });
    expect((fixture.nativeElement as HTMLElement).querySelector('table')).toBeNull();
  });

  it('emits approve/reject with the correct approval payload', () => {
    const fixture = mount(cardWithRows);
    const emitted: Approval[][] = [];
    fixture.componentInstance.resolve.subscribe((a) => emitted.push(a));

    const [approve, reject] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    approve.click();
    reject.click();

    expect(emitted[0]).toEqual([{ toolUseId: 'w1', approved: true }]);
    expect(emitted[1]).toEqual([{ toolUseId: 'w1', approved: false }]);
  });
});
