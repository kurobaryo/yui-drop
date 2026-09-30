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
 *   fragments and relative URLs. `javascript:`, `data:` and any other scheme
 *   are stripped (markdown-it and DOMPurify reject most of these already; the
 *   explicit allowlist does not depend on either default).
 * - **Images never load from another origin.** Opening a share must not ping a
 *   third-party server (tracking pixels, IP/User-Agent leaks), so `![alt](src)`
 *   pointing elsewhere is rendered as an ordinary link to `src` instead of an
 *   `<img>`. Inline `data:` raster images and same-origin images still render.
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

// Remote images become a plain link (alt text, or the URL) — see header.
const defaultImage = md.renderer.rules.image!;
md.renderer.rules.image = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  const src = token.attrGet('src') ?? '';
  if (isLocalImageSrc(src)) return defaultImage(tokens, idx, options, env, self);
  const label = self.renderInlineAsText(token.children ?? [], options, env) || src;
  const esc = md.utils.escapeHtml;
  return `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer nofollow">${esc(label)}</a>`;
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
