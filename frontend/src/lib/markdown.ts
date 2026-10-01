/**
 * Markdown renderer. Uses markdown-it for parsing (small, fast) and
 * DOMPurify to sanitize HTML output before injecting into the DOM.
 *
 * NEVER feed untrusted markdown into the DOM without going through this
 * helper.
 *
 * On top of `html: false` + DOMPurify, two rules apply to the untrusted source:
 *
 * - **Links** keep their `href` only for http(s), mailto, same-document
 *   fragments and relative URLs ({@link isSafeHref}). Any other scheme
 *   (`javascript:`, `data:`, `vbscript:`, `file:`, …) renders as just the
 *   label text in an attribute-less `<span>`. markdown-it's own validateLink
 *   is switched off for this: it refused to parse such links at all, which
 *   left `[label](javascript:…)` on screen as literal Markdown source.
 * - **Images never load from another origin.** Opening a share must not ping a
 *   third-party server (tracking pixels, IP/User-Agent leaks), so `![alt](src)`
 *   pointing elsewhere is rendered as an ordinary link to `src` instead of an
 *   `<img>`, and one with an unsafe scheme as its alt text alone. Inline
 *   `data:` raster images and same-origin images still render.
 *
 * The DOMPurify hooks at the bottom re-check both rules on the final HTML.
 */
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({
  html: false, // never trust raw HTML in markdown
  linkify: true,
  breaks: false,
  typographer: false,
});

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const DATA_IMAGE_RE = /^data:image\/(?:png|gif|jpe?g|webp|avif)[;,]/i;

/** May this `href` stay on a rendered link? */
export function isSafeHref(href: string | null | undefined): boolean {
  const v = (href ?? '').trim();
  if (!v) return false;
  if (v.startsWith('#')) return true;
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(v, window.location.href).protocol);
  } catch {
    return false;
  }
}

/** May this image `src` be loaded? Only inline data images and our own origin. */
export function isLocalImageSrc(src: string | null | undefined): boolean {
  const v = (src ?? '').trim();
  if (!v) return false;
  if (DATA_IMAGE_RE.test(v)) return true;
  try {
    const u = new URL(v, window.location.href);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === window.location.origin;
  } catch {
    return false;
  }
}

// Parse every link destination; the rule and renderers below decide what
// survives, using the allowlists above rather than markdown-it's blocklist.
md.validateLink = () => true;

// Unsafe links keep their label but lose the link: a link_open/link_close
// pair whose href fails isSafeHref becomes an attribute-less <span> pair.
// Covers inline, reference and autolinks alike (linkify only ever produces
// http(s)/mailto/ftp URLs; ftp: ends up here too).
md.core.ruler.push('unsafe_links', (state) => {
  for (const block of state.tokens) {
    if (block.type !== 'inline' || !block.children) continue;
    const defanged: boolean[] = [];
    for (const tok of block.children) {
      if (tok.type === 'link_open') {
        const unsafe = !isSafeHref(tok.attrGet('href'));
        defanged.push(unsafe);
        if (unsafe) {
          // No renderer rule for this type → renderToken → bare `<span>`.
          tok.type = 'unsafe_link_open';
          tok.tag = 'span';
          tok.attrs = null;
        }
      } else if (tok.type === 'link_close' && defanged.pop()) {
        tok.type = 'unsafe_link_close';
        tok.tag = 'span';
      }
    }
  }
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

// Remote images become a plain link (alt text, or the URL); images with an
// unsafe scheme become their alt text alone — see header.
const defaultImage = md.renderer.rules.image!;
md.renderer.rules.image = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  const src = token.attrGet('src') ?? '';
  if (isLocalImageSrc(src)) return defaultImage(tokens, idx, options, env, self);
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const esc = md.utils.escapeHtml;
  if (!isSafeHref(src)) return esc(alt);
  return `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer nofollow">${esc(alt || src)}</a>`;
};

// A private DOMPurify instance so these hooks never leak into other callers.
const purifier = DOMPurify(window);
purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    if (node.hasAttribute('href') && !isSafeHref(node.getAttribute('href'))) node.removeAttribute('href');
  } else if (node.tagName === 'IMG') {
    // Defence in depth for the renderer rule above.
    if (!isLocalImageSrc(node.getAttribute('src'))) node.removeAttribute('src');
    node.removeAttribute('srcset');
  }
});

export function renderMarkdown(src: string): string {
  const dirty = md.render(src);
  return purifier.sanitize(dirty, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
  });
}
