/**
 * Markdown renderer. Uses markdown-it for parsing (small, fast) and
 * DOMPurify to sanitize HTML output before injecting into the DOM.
 *
 * NEVER feed untrusted markdown into the DOM without going through this
 * helper.
 */
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({
  html: false, // never trust raw HTML in markdown
  linkify: true,
  breaks: false,
  typographer: false,
});

// Force external links to open in a new tab without referrer.
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };
md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  const hrefIdx = token.attrIndex('href');
  if (hrefIdx >= 0) {
    token.attrJoin('rel', 'noopener noreferrer nofollow');
    token.attrSet('target', '_blank');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(src: string): string {
  const dirty = md.render(src);
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
}
