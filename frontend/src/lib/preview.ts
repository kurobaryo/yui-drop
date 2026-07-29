/**
 * Preview + download helpers shared by every pickup surface (v2 dialog,
 * legacy washi modal, collection rooms).
 *
 * Two problems live here:
 *
 * 1. **What can we render inline?** The backend hands us a `content_type`
 *    guessed by Python's `mimetypes`, which returns `null` for common plain-text
 *    extensions (`.log`, `.yaml`, `.env`, `.toml`, …) and MIME strings that are
 *    not `text/*` for others (`application/json`, `application/x-sh`). A naive
 *    `ct.startsWith('text/')` check therefore misses most of the text files
 *    people actually share, which is why `.md` shares showed a grey file icon
 *    instead of the Markdown renderer that was already built.
 *
 * 2. **How do we make a link actually download?** The `/api/share/download`
 *    proxy serves bytes `inline` by default so `<img>` / `<video>` / `<iframe>`
 *    previews work. A bare link to it therefore *renders* the file in a new tab
 *    rather than saving it. `?dl=1` flips the backend to
 *    `Content-Disposition: attachment`; `downloadHref()` is the single place
 *    that appends it.
 */

/** Extensions we treat as plain text regardless of what the server guessed. */
const TEXT_EXTENSIONS = new Set([
  'md', 'markdown', 'mdx', 'txt', 'text', 'log', 'csv', 'tsv',
  'json', 'json5', 'jsonl', 'ndjson', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift',
  'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'pl', 'lua', 'r', 'scala', 'dart', 'ex', 'exs',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'graphql', 'gql', 'proto', 'diff', 'patch',
  'css', 'scss', 'sass', 'less', 'styl',
  'gitignore', 'dockerignore', 'editorconfig', 'lock',
]);

/**
 * MIME types that are textual but do not start with `text/`. Kept explicit
 * rather than pattern-matched so a novel `application/*` type is never
 * optimistically dumped into a `<pre>`.
 */
const TEXT_MIMES = new Set([
  'application/json',
  'application/ld+json',
  'application/x-ndjson',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/x-sh',
  'application/x-shellscript',
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'application/sql',
  'application/graphql',
  'application/x-httpd-php',
  'application/x-python',
  'application/x-python-code',
  'application/rtf',
]);

/**
 * MIME types that are textual in principle but must never be rendered inline:
 * the backend already forces an attachment for these (XSS vectors), so the
 * preview surface must not try to fetch and display them either.
 */
const NEVER_INLINE_MIMES = new Set([
  'text/html',
  'image/svg+xml',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
]);

/** Lowercased extension of a filename, without the dot. `''` when absent. */
export function extensionOf(name: string | null | undefined): string {
  if (!name) return '';
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** Strip parameters/whitespace from a Content-Type (`text/md; charset=utf-8`). */
function bareMime(ct: string | null | undefined): string {
  return (ct ?? '').split(';')[0].trim().toLowerCase();
}

/**
 * Is this share safe and sensible to render as text in the pickup preview?
 *
 * Errs on the side of the extension when the server could not guess a MIME
 * (Python's `mimetypes` returns `null` for `.log`, `.yaml`, `.env`, …), and
 * refuses anything on the never-inline list even if it looks textual.
 */
export function isTextPreviewable(
  contentType: string | null | undefined,
  name: string | null | undefined,
): boolean {
  const mime = bareMime(contentType);
  if (mime && NEVER_INLINE_MIMES.has(mime)) return false;

  const ext = extensionOf(name);
  // `.svg` / `.html` can arrive with a null or lying MIME — block by extension
  // too so the never-inline rule can't be bypassed by a missing content-type.
  if (['svg', 'html', 'htm', 'xhtml', 'xml'].includes(ext)) return false;

  if (mime.startsWith('text/')) return true;
  if (mime && TEXT_MIMES.has(mime)) return true;
  // No usable MIME (server guessed nothing, or a generic octet-stream fallback)
  // — fall back to the extension allow-list.
  if (!mime || mime === 'application/octet-stream') return TEXT_EXTENSIONS.has(ext);
  return false;
}

/** Should this share render as Markdown rather than a plain `<pre>`? */
export function isMarkdownName(name: string | null | undefined): boolean {
  return ['md', 'markdown', 'mdx'].includes(extensionOf(name));
}

/**
 * Append `?dl=1` so the backend answers with `Content-Disposition: attachment`.
 *
 * Without this a "Download" link just navigates to an inline response and the
 * browser renders the file in a tab instead of saving it. Non-proxy URLs
 * (presigned S3, `data:`, absolute third-party) are returned untouched.
 */
export function downloadHref(url: string | null | undefined): string {
  if (!url) return '';
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  // Only our own proxy understands ?dl=1.
  if (!url.includes('/api/share/download')) return url;
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.set('dl', '1');
    // Preserve relative-ness so the SPA keeps working behind any origin.
    return url.startsWith('http') ? u.toString() : `${u.pathname}${u.search}`;
  } catch {
    return url.includes('?') ? `${url}&dl=1` : `${url}?dl=1`;
  }
}

/**
 * Trigger a real browser download for `url` without navigating away.
 *
 * `window.open` was the old approach; combined with an inline disposition it
 * produced the "download opens a viewer tab" bug. A synthetic anchor with the
 * `download` attribute keeps the current page put and lets the browser save
 * straight to disk.
 */
export function triggerDownload(url: string | null | undefined, filename?: string | null): void {
  const href = downloadHref(url);
  if (!href) return;
  const a = document.createElement('a');
  a.href = href;
  if (filename) a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Save an in-memory text share as a UTF-8 `.txt` file.
 *
 * Pure text shares are returned inside `/share/select` and have no storage URL,
 * so `triggerDownload()` cannot handle them. A Blob URL avoids the length and
 * Unicode pitfalls of a `data:` URL. Revocation is deferred because Safari may
 * not start consuming the object URL synchronously when the anchor is clicked.
 */
export function triggerTextDownload(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Cap on how much of a text share we pull down for the inline preview. */
export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

export interface TextPreviewResult {
  text: string;
  /** True when the file exceeded {@link TEXT_PREVIEW_MAX_BYTES} and was cut. */
  truncated: boolean;
}

/**
 * Fetch a text share's body for inline preview.
 *
 * Deliberately hits the **inline** URL (no `?dl=1`) so no download is recorded
 * as an attachment, and reads at most {@link TEXT_PREVIEW_MAX_BYTES} so a
 * multi-megabyte log doesn't lock up the tab.
 */
export async function fetchTextPreview(
  url: string,
  size?: number | null,
  signal?: AbortSignal,
): Promise<TextPreviewResult> {
  const res = await fetch(url, { signal, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`preview_fetch_failed_${res.status}`);
  const willTruncate = typeof size === 'number' && size > TEXT_PREVIEW_MAX_BYTES;

  if (!willTruncate) {
    const text = await res.text();
    if (text.length <= TEXT_PREVIEW_MAX_BYTES) return { text, truncated: false };
    return { text: text.slice(0, TEXT_PREVIEW_MAX_BYTES), truncated: true };
  }

  // Large file: stream and stop once we have enough bytes.
  const buf = await res.arrayBuffer();
  const slice = buf.slice(0, TEXT_PREVIEW_MAX_BYTES);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
  return { text, truncated: true };
}
