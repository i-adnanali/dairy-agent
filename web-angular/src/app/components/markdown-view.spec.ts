import { TestBed } from '@angular/core/testing';
import { MarkdownView } from './markdown-view';

describe('MarkdownView', () => {
  function render(text: string): HTMLElement {
    const fixture = TestBed.createComponent(MarkdownView);
    fixture.componentRef.setInput('text', text);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders GFM tables', () => {
    const md = ['| Tag | Yield |', '| --- | --- |', '| K-01 | 6.2 |'].join('\n');
    const el = render(md);
    expect(el.querySelector('table')).toBeTruthy();
    expect(el.querySelector('th')?.textContent).toContain('Tag');
    expect(el.querySelector('td')?.textContent).toContain('K-01');
  });

  it('renders basic formatting (bold, lists)', () => {
    const el = render('**hi**\n\n- one\n- two');
    expect(el.querySelector('strong')?.textContent).toBe('hi');
    expect(el.querySelectorAll('li')).toHaveLength(2);
  });

  it('strips disallowed/unsafe markup', () => {
    const el = render('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\nok');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('ok');
  });
});
