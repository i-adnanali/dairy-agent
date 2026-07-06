import { TestBed } from '@angular/core/testing';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the three starter prompts and emits the picked one', () => {
    const fixture = TestBed.createComponent(EmptyState);
    fixture.detectChanges();
    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    );
    expect(buttons).toHaveLength(3);

    let picked: string | undefined;
    fixture.componentInstance.pick.subscribe((v) => (picked = v));
    buttons[0].click();
    expect(picked).toContain('Kundi');
  });
});
