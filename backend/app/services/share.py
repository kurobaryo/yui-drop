"""Share service — text/file create + select."""
from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime
from typing import IO, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.crypto import generate_dek, wrap_dek
from ..core.filenames import build_storage_key, sanitize_filename
from ..core.rate_limit import retrieve_fail_tracker
from ..core.security import generate_unique_pickup_code
from ..models.access_log import AccessLogAction
from ..models.file_code import FileCode
from ..storage import get_storage
from .common import (
    ForbiddenError,
    NotFoundError,
    ServiceError,
    as_utc,
    compute_expiry,
    record_access,
)

# MIME types we never serve inline — too dangerous (XSS / clickjacking) in
# the browser. Forces a download attachment instead.
FORCE_DOWNLOAD_MIMES: frozenset[str] = frozenset(
    {
        "image/svg+xml",
        "text/html",
        "application/xhtml+xml",
        "application/xml",
    }
)

# Simple-upload threshold. Anything larger should use chunk/* or presign/*.
# Legacy default — kept as a fallback when ``settings_kv`` has no override.
# Runtime callers resolve the live value via
# :func:`app.services.admin_uploads.resolve_upload_limits`.
SIMPLE_UPLOAD_MAX = 10 * 1024 * 1024  # 10 MiB
SHA_BUF = 1024 * 1024  # 1 MiB read buffer


def _use_local_at_rest_encryption() -> bool:
    """True when on-disk encryption should be applied to new local writes.

    Local backend → encrypt (DEK wrapped + stored on the FileCode row).
    Other backends → no-op (S3/R2 rely on bucket-side SSE-S3; future
    backends decide their own story).

    Resolution: we ask the **active storage singleton** whether it exposes
    ``server_write_encrypted``. This is correct even when ``settings.storage_backend``
    (the env default) disagrees with the ``settings_kv`` overlay that the
    admin UI writes at runtime — the singleton reflects the overlay because
    :func:`reload_storage` is called from the app's lifespan.
    """
    return hasattr(get_storage(), "server_write_encrypted")


async def _code_exists(db: AsyncSession, code: str) -> bool:
    """Active (non-soft-deleted) collision check used by the code generator."""
    q = select(FileCode.id).where(FileCode.code == code, FileCode.deleted_at.is_(None))
    res = await db.execute(q)
    return res.first() is not None


def _split_filename(name: str) -> tuple[str, str | None]:
    """Return ``(prefix, suffix-with-dot)`` for storage-table columns."""
    name = sanitize_filename(name)
    if "." in name:
        stem, ext = name.rsplit(".", 1)
        return stem, f".{ext}"
    return name, None


# ────────────────────────────────────────────────────────────────────────────
# CREATE: text
# ────────────────────────────────────────────────────────────────────────────


async def create_text_share(
    db: AsyncSession,
    *,
    text: str,
    expire_value: int,
    expire_style: str,
    ip: str | None,
    ua: str | None,
    created_by_key_id: int | None = None,
) -> dict[str, Any]:
    """Insert a text-only FileCode row and return its summary.

    ``created_by_key_id`` attributes the share to an admin-issued API key so
    it shows up in ``GET /api/v1/shares``. Anonymous callers (the SPA) leave
    it ``None``, matching :func:`create_simple_file_share`.
    """
    body = text or ""
    if len(body.encode("utf-8")) > settings.max_text_bytes:
        raise ServiceError(
            "text_too_large", code=4131, http_status=413,
            detail={"max_bytes": settings.max_text_bytes},
        )

    expired_at, expired_count = compute_expiry(expire_value, expire_style)
    code = await generate_unique_pickup_code(lambda c: _code_exists(db, c))

    row = FileCode(
        code=code,
        prefix=None,
        suffix=None,
        name=None,
        size=len(body.encode("utf-8")),
        file_path=None,
        text=body,
        file_hash=None,
        # Without this the row inherits the column default "file" and every
        # text share is reported as kind="file" on the wire (harmless while
        # the only reader tested `kind == "multi"`, wrong once /api/v1
        # started surfacing it). Readers that need the old inference use
        # `text is not None and file_path is None`.
        kind="text",
        expired_at=expired_at,
        expired_count=expired_count,
        used_count=0,
        is_chunked=False,
        upload_id=None,
        created_by_ip=ip,
        created_by_ua=ua,
        created_by_key_id=created_by_key_id,
    )
    db.add(row)
    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        code=code,
        ip=ip,
        ua=ua,
        extra={"event": "share.create.text", "size": row.size},
    )
    await db.commit()
    return {
        "code": code,
        "name": None,
        "expired_at": expired_at.isoformat() if expired_at else None,
        "expired_count": expired_count,
    }


# ────────────────────────────────────────────────────────────────────────────
# CREATE: simple file (≤ SIMPLE_UPLOAD_MAX)
# ────────────────────────────────────────────────────────────────────────────


async def create_simple_file_share(
    db: AsyncSession,
    *,
    file_name: str,
    file_obj: IO[bytes],
    file_size: int,
    content_type: str | None,
    expire_value: int,
    expire_style: str,
    ip: str | None,
    ua: str | None,
    created_by_key_id: int | None = None,
) -> dict[str, Any]:
    """Server-write a small file blob then create the FileCode row."""
    if file_size <= 0:
        raise ServiceError("empty_file", code=4001, http_status=400)
    # Pull the admin-configured simple-upload cap from settings_kv (with a
    # safe fallback to the historic 10 MiB constant). Local import to avoid
    # a circular dependency on the service-aggregator module.
    from .admin_uploads import resolve_upload_limits

    _limits = await resolve_upload_limits(db)
    simple_cap = int(_limits["simple_upload_max_bytes"])
    if file_size > simple_cap:
        raise ServiceError(
            "file_too_large_for_simple_upload",
            code=4132,
            http_status=413,
            detail={"max_bytes": simple_cap},
        )
    if file_size > settings.max_upload_bytes:
        raise ServiceError(
            "file_too_large",
            code=4133,
            http_status=413,
            detail={"max_bytes": settings.max_upload_bytes},
        )

    safe = sanitize_filename(file_name)
    prefix, suffix = _split_filename(safe)
    # Compute sha256 + buffer to a temp file so we can both hash and upload.
    # For 10 MiB max we just read it all into memory — simpler.
    data = file_obj.read()
    if len(data) != file_size and file_size > 0:
        # Trust the actual byte count we read.
        file_size = len(data)
    sha = hashlib.sha256(data).hexdigest()

    # Hash hit → reuse the existing file_path, only mint a new code.
    existing_q = select(FileCode).where(
        FileCode.file_hash == sha, FileCode.deleted_at.is_(None), FileCode.file_path.is_not(None)
    ).limit(1)
    existing = (await db.execute(existing_q)).scalars().first()

    if existing is not None:
        storage_key = existing.file_path
        wrapped: bytes | None = existing.wrapped_dek
    else:
        storage_key = build_storage_key(None, safe)
        import io

        if _use_local_at_rest_encryption():
            dek = generate_dek()
            wrapped = wrap_dek(dek)
            storage = get_storage()
            # LocalStorage exposes server_write_encrypted; other backends
            # don't (and shouldn't be reached on the local-encryption path).
            await storage.server_write_encrypted(  # type: ignore[attr-defined]
                storage_key, io.BytesIO(data), dek
            )
        else:
            wrapped = None
            await get_storage().server_write(storage_key, io.BytesIO(data), file_size)

    expired_at, expired_count = compute_expiry(expire_value, expire_style)
    code = await generate_unique_pickup_code(lambda c: _code_exists(db, c))

    row = FileCode(
        code=code,
        prefix=prefix,
        suffix=suffix,
        name=safe,
        size=file_size,
        file_path=storage_key,
        text=None,
        file_hash=sha,
        expired_at=expired_at,
        expired_count=expired_count,
        used_count=0,
        is_chunked=False,
        upload_id=None,
        wrapped_dek=wrapped,
        created_by_ip=ip,
        created_by_ua=ua,
        created_by_key_id=created_by_key_id,
    )
    db.add(row)
    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        code=code,
        ip=ip,
        ua=ua,
        extra={
            "event": "share.create.file",
            "size": file_size,
            "name": safe,
            "dedup": existing is not None,
        },
    )
    await db.commit()
    return {
        "code": code,
        "name": safe,
        "size": file_size,
        "expired_at": expired_at.isoformat() if expired_at else None,
        "expired_count": expired_count,
    }


# ────────────────────────────────────────────────────────────────────────────
# SELECT (resolve a pickup code)
# ────────────────────────────────────────────────────────────────────────────


def _guess_content_type(name: str | None, suffix: str | None) -> str | None:
    """Best-effort content-type guess used only when storage doesn't provide one."""
    import mimetypes

    if not name and not suffix:
        return None
    cand = name or f"x{suffix or ''}"
    ct, _ = mimetypes.guess_type(cand)
    return ct


async def resolve_share(
    db: AsyncSession,
    *,
    code: str,
    ip: str | None,
    ua: str | None,
    fail_key: str | None = None,
) -> dict[str, Any]:
    """Look up an active share and return a payload pointer for the client.

    Enforces:
        * soft-delete + expiry filters
        * per-caller retrieve-failure tracking (banned after threshold)
        * decrements ``expired_count`` and bumps ``used_count`` on success

    ``fail_key`` selects the identity that failure-tracking bans. It defaults
    to ``ip`` (the anonymous SPA path). Authenticated callers that reach us
    through a server-side proxy MUST pass a caller-specific key (e.g.
    ``"key:<api_key.id>"``) — otherwise every proxied request shares the
    proxy's IP and one client fat-fingering codes would ban the whole
    upstream host. ``ip`` is still recorded in the audit log either way.
    """
    tracked = fail_key if fail_key is not None else ip

    # Banned caller? Short-circuit.
    if tracked and await retrieve_fail_tracker.is_banned(tracked):
        raise ForbiddenError("ip_banned", detail={"reason": "too_many_failures"})

    now = datetime.now(tz=UTC)
    q = (
        select(FileCode)
        .where(FileCode.code == code, FileCode.deleted_at.is_(None))
        .limit(1)
    )
    row = (await db.execute(q)).scalars().first()

    # ── Failure path: record + maybe ban
    async def _miss(reason: str) -> None:
        await record_access(
            db,
            action=AccessLogAction.SHARE_RETRIEVE,
            code=code,
            ip=ip,
            ua=ua,
            status_code=404,
            extra={"event": "share.retrieve.miss", "reason": reason},
        )
        await db.commit()
        if tracked:
            n = await retrieve_fail_tracker.record_failure(tracked)
            if n >= settings.rate_limit_retrieve_fails_per_hour:
                await retrieve_fail_tracker.ban(
                    tracked, settings.retrieve_ban_duration_min * 60
                )

    if row is None:
        await _miss("not_found")
        raise NotFoundError("code_not_found")

    if row.expired_at is not None and as_utc(row.expired_at) <= now:
        await _miss("expired_time")
        raise NotFoundError("code_expired")
    if row.expired_count == 0:
        await _miss("expired_count")
        raise NotFoundError("code_expired")

    # ── Success path
    if row.expired_count > 0:
        row.expired_count -= 1
    row.used_count = (row.used_count or 0) + 1

    # Multi-file share: row.kind='multi' + finalized — list its files.
    if row.kind == "multi":
        if not row.finalized:
            await _miss("share_not_finalized")
            raise NotFoundError("share_not_finalized")
        # Lazy import to avoid a cycle.
        from ..models.share_file import ShareFile

        sfs = (
            await db.execute(
                select(ShareFile)
                .where(ShareFile.share_id == row.id, ShareFile.state == "complete")
                .order_by(ShareFile.order)
            )
        ).scalars().all()

        files_out = []
        for sf in sfs:
            ct = _guess_content_type(sf.name, sf.suffix)
            force_dl = bool(ct and ct in FORCE_DOWNLOAD_MIMES)
            # Always hand out the same-origin proxy path. Routing the bytes
            # through our backend (instead of an R2 presigned URL) avoids
            # the cross-origin CORS wall that breaks <img> previews and
            # keeps storage credentials server-side.
            url = f"/api/share/download/{row.code}/{sf.id}"
            files_out.append({
                "file_id": sf.id,
                "order": sf.order,
                "name": sf.name,
                "size": sf.size,
                "url": url,
                "content_type": ct,
                "force_download": force_dl,
            })

        await record_access(
            db,
            action=AccessLogAction.SHARE_RETRIEVE,
            code=code,
            ip=ip,
            ua=ua,
            status_code=200,
            extra={"event": "share.retrieve.multi", "file_count": len(files_out)},
        )
        await db.commit()
        if tracked:
            await retrieve_fail_tracker.record_success(tracked)
        return {
            "code": row.code,
            "kind": "multi",
            "name": None,
            "size": None,
            "text": None,
            "url": None,
            "content_type": None,
            "force_download": False,
            "expired_at": row.expired_at.isoformat() if row.expired_at else None,
            "expired_count": row.expired_count,
            "used_count": row.used_count,
            "total_size": row.total_size or 0,
            "file_count": row.file_count,
            "files": files_out,
        }

    is_text = row.text is not None and row.file_path is None
    if is_text:
        await record_access(
            db,
            action=AccessLogAction.SHARE_RETRIEVE,
            code=code,
            ip=ip,
            ua=ua,
            status_code=200,
            extra={"event": "share.retrieve.text"},
        )
        await db.commit()
        if tracked:
            await retrieve_fail_tracker.record_success(tracked)
        return {
            "code": row.code,
            "kind": "text",
            "name": None,
            "size": row.size,
            "text": row.text,
            "url": None,
            "content_type": "text/plain",
            "force_download": False,
            "expired_at": row.expired_at.isoformat() if row.expired_at else None,
            "expired_count": row.expired_count,
            "used_count": row.used_count,
        }

    # File path
    ct = _guess_content_type(row.name, row.suffix)
    force_dl = bool(ct and ct in FORCE_DOWNLOAD_MIMES)
    # Same-origin proxy URL. The dedicated /download/{code} route streams
    # bytes from storage (R2/local) without ever exposing a presigned URL
    # to the client — restores <img> previews and centralises access
    # logging.
    url = f"/api/share/download/{row.code}"

    await record_access(
        db,
        action=AccessLogAction.SHARE_RETRIEVE,
        code=code,
        ip=ip,
        ua=ua,
        status_code=200,
        extra={"event": "share.retrieve.file", "force_download": force_dl},
    )
    await db.commit()
    if tracked:
        await retrieve_fail_tracker.record_success(tracked)
    return {
        "code": row.code,
        "kind": "file",
        "name": row.name,
        "size": row.size,
        "text": None,
        "url": url,
        "content_type": ct,
        "force_download": force_dl,
        "expired_at": row.expired_at.isoformat() if row.expired_at else None,
        "expired_count": row.expired_count,
        "used_count": row.used_count,
    }


# ────────────────────────────────────────────────────────────────────────────
# DOWNLOAD (local-backend token-protected proxy)
# ────────────────────────────────────────────────────────────────────────────


async def authorize_download_token(token: str) -> tuple[str, str | None]:
    """Validate a download token (local-backend only). Returns ``(key, filename)``."""
    from ..core.security import decode_jwt

    try:
        payload = decode_jwt(token)
    except Exception as exc:
        raise ForbiddenError("bad_token", detail={"reason": str(exc)}) from exc
    key = payload.get("key")
    if not key or not isinstance(key, str):
        raise ForbiddenError("bad_token")
    fn = payload.get("fn") or None
    return key, fn


async def open_download_stream(key: str, wrapped_dek: bytes | None = None):
    """Return ``(async-iter, head)`` for the given storage key.

    If ``wrapped_dek`` is non-None the bytes are decrypted on the way out
    via :meth:`LocalStorage.server_read_encrypted`; the reported
    ``head['size']`` is adjusted so callers don't advertise the on-disk
    (header-padded) size to the client.
    """
    from ..core.crypto import HEADER_BYTES, unwrap_dek

    storage = get_storage()
    try:
        head = await storage.head(key)
    except FileNotFoundError as exc:
        raise NotFoundError("object_not_found") from exc
    if wrapped_dek:
        dek = unwrap_dek(wrapped_dek)
        body = await storage.server_read_encrypted(key, dek)  # type: ignore[attr-defined]
        # Plaintext size = on-disk size − fixed header (nonce + tag).
        if head.get("size") is not None:
            head = {**head, "size": max(0, int(head["size"]) - HEADER_BYTES)}
    else:
        body = await storage.server_read(key)
    return body, head


# ────────────────────────────────────────────────────────────────────────────
# DOWNLOAD-BY-CODE (same-origin proxy)
# ────────────────────────────────────────────────────────────────────────────


async def resolve_download_target(
    db: AsyncSession,
    *,
    code: str,
    file_id: int | None = None,
) -> dict[str, Any]:
    """Resolve a pickup code (and optional file_id) to a streamable storage target.

    Returns ``{key, name, content_type, force_download, size}``.

    Validates soft-delete + time-based expiry but DOES NOT decrement the
    pickup counter (those counters are owned by :func:`resolve_share`,
    which the client already hit to obtain the proxy URL). A NotFoundError
    is raised in any condition that would have caused ``/select`` to
    refuse the lookup, plus the file_id / file_path consistency checks.
    """
    now = datetime.now(tz=UTC)
    q = (
        select(FileCode)
        .where(FileCode.code == code, FileCode.deleted_at.is_(None))
        .limit(1)
    )
    row = (await db.execute(q)).scalars().first()
    if row is None:
        raise NotFoundError("code_not_found")
    if row.expired_at is not None and as_utc(row.expired_at) <= now:
        raise NotFoundError("code_expired")

    # Multi-file: file_id must be supplied and belong to this share.
    if row.kind == "multi":
        if file_id is None:
            raise NotFoundError("file_id_required")
        from ..models.share_file import ShareFile

        sf = (
            await db.execute(
                select(ShareFile).where(
                    ShareFile.id == file_id,
                    ShareFile.share_id == row.id,
                    ShareFile.state == "complete",
                ).limit(1)
            )
        ).scalars().first()
        if sf is None:
            raise NotFoundError("file_not_found")
        ct = _guess_content_type(sf.name, sf.suffix) or "application/octet-stream"
        force_dl = ct in FORCE_DOWNLOAD_MIMES
        return {
            "key": sf.file_path,
            "name": sf.name,
            "content_type": ct,
            "force_download": force_dl,
            "size": sf.size,
            # Multi-share files inherit the parent FileCode's wrapped DEK.
            "wrapped_dek": row.wrapped_dek,
        }

    # Single-file share. Text shares have no payload to stream.
    if row.file_path is None:
        raise NotFoundError("not_a_file_share")
    if file_id is not None:
        # Reject file_id on a non-multi share so /code/<id> can't smuggle.
        raise NotFoundError("file_id_not_applicable")

    ct = _guess_content_type(row.name, row.suffix) or "application/octet-stream"
    force_dl = ct in FORCE_DOWNLOAD_MIMES
    return {
        "key": row.file_path,
        "name": row.name or row.code,
        "content_type": ct,
        "force_download": force_dl,
        "size": row.size,
        "wrapped_dek": row.wrapped_dek,
    }


__all__ = [
    "create_text_share",
    "create_simple_file_share",
    "resolve_share",
    "resolve_download_target",
    "authorize_download_token",
    "open_download_stream",
    "FORCE_DOWNLOAD_MIMES",
    "SIMPLE_UPLOAD_MAX",
]

# Avoid "imported but unused" complaints from ruff when the module is imported
# for side-effects only.
_ = os
_ = SHA_BUF
