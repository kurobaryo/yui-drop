"""Serve-time content-type policy for uploaded files.

Share payloads come from anonymous uploaders and are streamed back from the
same origin as the SPA, so the ``Content-Type`` / ``Content-Disposition`` pair
we attach decides whether an upload stays inert data or becomes an active
document on our origin. This module is the single place that decides it.

Rules
-----
* The type is derived **only** from the stored (sanitised) file name. The
  uploader-declared content type is never consulted — S3-compatible backends
  echo it back verbatim on HEAD/GET, so trusting it would let the uploader pick
  the type we serve. Python's ``mimetypes`` is not consulted either: its answer
  depends on the host's ``mime.types`` database, and every type we serve inline
  is listed explicitly below anyway.
* Only an allowlist is ever served ``inline``: raster images (no SVG), audio,
  video, PDF, and text previews. Text previews are always served as
  ``text/plain; charset=utf-8`` regardless of extension, so a ``.md`` or
  ``.json`` upload renders as plain text if opened directly.
* Everything else — markup (HTML, XHTML, SVG, XML, XSL, RDF), browser-native
  script/style (``.js``, ``.mjs``, ``.cjs``, ``.css``), web archives
  (``.mht``), unknown extensions and extension-less names — is served as
  ``application/octet-stream`` with ``Content-Disposition: attachment``.

Because the decision is made at serve time, objects that were uploaded with a
misleading stored content type are covered without rewriting storage metadata.

Response hardening
------------------
:func:`file_response_headers` adds the same headers to every file response,
inline or attachment:

* ``X-Content-Type-Options: nosniff`` so the declared type is final (this is
  also what keeps a ``text/plain`` body from being usable as a script).
* ``Content-Security-Policy`` with ``default-src 'none'`` and ``sandbox``: if a
  browser ever renders the bytes as a document it runs no script and gets an
  opaque origin, so it cannot read the SPA's storage.
* ``Cross-Origin-Resource-Policy: same-origin`` and
  ``X-Frame-Options: SAMEORIGIN`` (the pickup sheet frames PDFs same-origin).

PDFs get the same CSP minus ``sandbox`` (plus ``object-src 'self'``). WebKit
refuses to load plugins — which includes its PDF viewer — in sandboxed
documents, and older Chromium did the same. Dropping ``sandbox`` there is safe
because a PDF is never parsed as HTML (explicit type + ``nosniff``), and every
current viewer (Chromium's PDFium, Firefox's pdf.js, WebKit's PDFKit) runs any
PDF scripting in its own isolated context without access to the embedding
page's DOM or storage. ``default-src 'none'`` still blocks script outright
should the bytes ever be treated as a document.
"""
from __future__ import annotations

OCTET_STREAM = "application/octet-stream"
TEXT_PLAIN = "text/plain; charset=utf-8"
PDF = "application/pdf"

_IMAGE_TYPES: dict[str, str] = {
    "png": "image/png",
    "apng": "image/apng",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "jpe": "image/jpeg",
    "jfif": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "avif": "image/avif",
    "bmp": "image/bmp",
    "ico": "image/x-icon",
    "heic": "image/heic",
    "heif": "image/heif",
    "tif": "image/tiff",
    "tiff": "image/tiff",
}

_VIDEO_TYPES: dict[str, str] = {
    "mp4": "video/mp4",
    "m4v": "video/mp4",
    "webm": "video/webm",
    "mov": "video/quicktime",
    "mkv": "video/x-matroska",
    "ogv": "video/ogg",
}

_AUDIO_TYPES: dict[str, str] = {
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
    "aac": "audio/aac",
    "wav": "audio/wav",
    "ogg": "audio/ogg",
    "oga": "audio/ogg",
    "opus": "audio/ogg",
    "flac": "audio/flac",
    "weba": "audio/webm",
}

INLINE_MEDIA_TYPES: dict[str, str] = {
    **_IMAGE_TYPES,
    **_VIDEO_TYPES,
    **_AUDIO_TYPES,
    "pdf": PDF,
}

# Extensions previewed as plain text. Mirrors ``TEXT_EXTENSIONS`` in
# ``frontend/src/lib/preview.ts`` except for js/mjs/cjs/css: those are types
# the browser executes or applies natively, so they are always attachments
# (the pickup preview still shows their source, fetched and rendered as text).
TEXT_PREVIEW_EXTENSIONS: frozenset[str] = frozenset(
    {
        "md", "markdown", "mdx", "txt", "text", "log", "csv", "tsv",
        "json", "json5", "jsonl", "ndjson", "yaml", "yml", "toml", "ini", "cfg",
        "conf", "env", "properties",
        "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt", "kts", "swift",
        "c", "h", "cc", "cpp", "hpp", "cs", "php", "pl", "lua", "r", "scala",
        "dart", "ex", "exs",
        "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
        "sql", "graphql", "gql", "proto", "diff", "patch",
        "scss", "sass", "less", "styl",
        "gitignore", "dockerignore", "editorconfig", "lock",
    }
)

_CSP_BASE = (
    "default-src 'none'; img-src 'self' data:; media-src 'self'; "
    "style-src 'unsafe-inline'; frame-ancestors 'self'"
)
SANDBOX_CSP = f"{_CSP_BASE}; sandbox"
PDF_CSP = f"{_CSP_BASE}; object-src 'self'"


def file_extension(name: str | None, suffix: str | None = None) -> str:
    """Lowercased final extension of ``name`` (or ``suffix`` when name is empty)."""
    source = name or suffix or ""
    base = source.replace("\\", "/").rsplit("/", 1)[-1]
    if "." not in base:
        return ""
    return base.rsplit(".", 1)[1].strip().lower()


def served_type(name: str | None, suffix: str | None = None) -> tuple[str, bool]:
    """Return ``(media_type, inline_ok)`` for a stored file name.

    ``inline_ok`` is False for anything outside the allowlist, in which case
    ``media_type`` is always ``application/octet-stream``.
    """
    ext = file_extension(name, suffix)
    media = INLINE_MEDIA_TYPES.get(ext)
    if media is not None:
        return media, True
    if ext in TEXT_PREVIEW_EXTENSIONS:
        return TEXT_PLAIN, True
    return OCTET_STREAM, False


def file_response_headers(media_type: str, *, inline: bool) -> dict[str, str]:
    """Hardening headers for a response that carries uploaded bytes."""
    csp = PDF_CSP if inline and media_type == PDF else SANDBOX_CSP
    return {
        "x-content-type-options": "nosniff",
        "content-security-policy": csp,
        "cross-origin-resource-policy": "same-origin",
        "x-frame-options": "SAMEORIGIN",
    }


__all__ = [
    "INLINE_MEDIA_TYPES",
    "OCTET_STREAM",
    "PDF",
    "PDF_CSP",
    "SANDBOX_CSP",
    "TEXT_PLAIN",
    "TEXT_PREVIEW_EXTENSIONS",
    "file_extension",
    "file_response_headers",
    "served_type",
]
