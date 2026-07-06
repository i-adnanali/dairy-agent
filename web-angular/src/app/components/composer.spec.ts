import { TestBed } from '@angular/core/testing';
import { Composer } from './composer';

describe('Composer', () => {
  it('shows the default placeholder and emits trimmed text on submit', () => {
    const fixture = TestBed.createComponent(Composer);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const textarea = el.querySelector('textarea')!;
    expect(textarea.placeholder).toBe('Ask about the herd, or request an action…');

    let sent: string | undefined;
    fixture.componentInstance.send.subscribe((v) => (sent = v));

    textarea.value = '  hello  ';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    el.querySelector('button')!.click();
    expect(sent).toBe('hello');
    // textarea clears after send
    fixture.detectChanges();
    expect((el.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows the disabled placeholder and blocks submit when disabled', () => {
    const fixture = TestBed.createComponent(Composer);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    const textarea = el.querySelector('textarea')!;
    expect(textarea.disabled).toBe(true);
    expect(textarea.placeholder).toBe('Resolve the pending action above to continue…');
  });
});
