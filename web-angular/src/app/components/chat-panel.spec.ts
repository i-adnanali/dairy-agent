import { TestBed } from '@angular/core/testing';
import type { PendingWrite } from '@dairy/shared';
import { ChatStore } from '../core/chat-store';
import { ChatPanel } from './chat-panel';

describe('ChatPanel', () => {
  let store: ChatStore;

  function mount() {
    const fixture = TestBed.createComponent(ChatPanel);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(ChatStore);
  });

  it('shows the empty state when there is no render log', () => {
    const fixture = mount();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-empty-state')).toBeTruthy();
    expect(el.querySelector('app-message-list')).toBeNull();
  });

  it('shows the message list and a Thinking indicator while loading', () => {
    store.renderLog.set([{ id: 'u1', role: 'user', text: 'hi' }]);
    store.loading.set(true);
    const fixture = mount();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-message-list')).toBeTruthy();
    expect(el.querySelector('app-empty-state')).toBeNull();
    expect(el.textContent).toContain('Thinking');
  });

  it('renders confirmation cards and an "Approve all" button for multiple pending writes', () => {
    const pending: PendingWrite[] = [
      { toolUseId: 'w1', toolName: 'log_milking', summary: 's1', details: [] },
      { toolUseId: 'w2', toolName: 'log_milking', summary: 's2', details: [] },
    ];
    store.renderLog.set([{ id: 'u1', role: 'user', text: 'log it' }]);
    store.pending.set(pending);
    const fixture = mount();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('app-confirmation-card')).toHaveLength(2);
    expect(el.textContent).toContain('Approve all (2)');
  });

  it('hides "Approve all" for a single pending write', () => {
    store.renderLog.set([{ id: 'u1', role: 'user', text: 'log it' }]);
    store.pending.set([
      { toolUseId: 'w1', toolName: 'log_milking', summary: 's1', details: [] },
    ]);
    const fixture = mount();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('app-confirmation-card')).toHaveLength(1);
    expect(el.textContent).not.toContain('Approve all');
  });

  it('renders the error banner', () => {
    store.error.set('Request failed (503)');
    const fixture = mount();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Request failed (503)',
    );
  });

  it('disables the composer while busy (pending)', () => {
    store.pending.set([
      { toolUseId: 'w1', toolName: 'log_milking', summary: 's1', details: [] },
    ]);
    const fixture = mount();
    const textarea = (fixture.nativeElement as HTMLElement).querySelector('textarea')!;
    expect(textarea.disabled).toBe(true);
  });
});
