import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

// Mirrors the react-markdown + remark-gfm allowlist in web-react/src/components/Message.tsx.
const ALLOWED_TAGS = [
  'p', 'strong', 'em', 'ul', 'ol', 'li', 'code', 'pre', 'a', 'h1', 'h2', 'h3',
  'br', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'del',
];

/**
 * Renders assistant markdown (GFM tables included) as sanitized HTML.
 * Replaces React's react-markdown + remark-gfm + DOMPurify pipeline.
 */
@Component({
  selector: 'app-markdown-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div [innerHTML]="html()"></div>`,
})
export class MarkdownView {
  readonly text = input<string>('');

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly html = computed<SafeHtml>(() => {
    const raw = marked.parse(this.text() ?? '', { async: false, gfm: true }) as string;
    const clean = DOMPurify.sanitize(raw, {
      ALLOWED_TAGS,
      ALLOWED_ATTR: ['href', 'title'],
    });
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  });
}
