"""Filename sanitization and storage-key composition.

These helpers run on every share create, so they're pure and side-effect free.
"""
from __future__ import annotations

import re
import unicodedata
import uuid
from datetime import UTC, date, datetime

# Windows reserved device names (case-insensitive, with or without extension).
_WINDOWS_RESERVED: frozenset[str] = frozenset(
    {
        "CON", "PRN", "AUX", "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }
)

# Control characters 0x00-0x1F and 0x7F (DEL).
_CTRL_RE = re.compile(r"[\x00-\x1f\x7f]")
# Path separators / shell-dangerous characters.
_BAD_RE = re.compile(r'[\\/:*?"<>|]')

# Hard cap on the final filename length to keep storage-key segments sane.
_MAX_NAME_LEN = 200


def sanitize_filename(name: str | None) -> str:
    """Return a safe, single-segment filename. Never raises.

    Steps:
      1. NFC-normalize and strip outer whitespace.
      2. Remove control characters and path separators.
      3. Collapse any '..' sequence (defence-in-depth against traversal).
      4. Strip leading dots / spaces (hidden files / Windows trailing dots).
      5. Prefix '_' if the stem matches a Windows reserved device name.
      6. Truncate to ``_MAX_NAME_LEN`` characters, preserving the extension.

    Falls back to ``"file"`` when the input is empty or sanitises to empty.
    """
    if not name:
        return "file"

    s = unicodedata.normalize("NFC", str(name)).strip()
    s = _CTRL_RE.sub("", s)
    s = s.replace("\x00", "")
    s = _BAD_RE.sub("_", s)

    # Defensively collapse any '..' (also covers '....', '...', etc.).
    while ".." in s:
        s = s.replace("..", "_")

    # Strip leading dots/spaces and trailing spaces/dots.
    s = s.lstrip(". ").rstrip(" .")
    if not s:
        return "file"

    # Windows reserved name guard (applies to stem only).
    stem = s.rsplit(".", 1)[0] if "." in s else s
    if stem.upper() in _WINDOWS_RESERVED:
        s = f"_{s}"

    # Length cap, preserving the final extension if possible.
    if len(s) > _MAX_NAME_LEN:
        if "." in s:
            stem, ext = s.rsplit(".", 1)
            keep = max(1, _MAX_NAME_LEN - len(ext) - 1)
            s = f"{stem[:keep]}.{ext}"
        else:
            s = s[:_MAX_NAME_LEN]

    return s or "file"


def build_storage_key(when: date | datetime | None, filename: str) -> str:
    """Compose a storage object key: ``share/YYYY/MM/DD/<uuid4-hex>/<sanitized>``.

    ``when`` may be a ``date``, ``datetime``, or ``None`` (=> now-UTC). The
    UUIDv4 segment guarantees uniqueness even if two clients upload the same
    filename in the same day.
    """
    if when is None:
        when = datetime.now(tz=UTC)
    elif isinstance(when, datetime):
        # Use the calendar date in the datetime's own tz (caller's choice).
        pass
    safe = sanitize_filename(filename)
    return f"share/{when:%Y/%m/%d}/{uuid.uuid4().hex}/{safe}"
