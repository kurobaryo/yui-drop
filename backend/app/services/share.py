"""Share service — text/file create + select."""
from __future__ import annotations

import hashlib
import os
from datetime import UTC, datetime
from typing import IO, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
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
SIMPLE_UPLOAD_MAX = 10 * 1024 * 1024  # 10 MiB
SHA_BUF = 1024 * 1024  # 1 MiB read buffer


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
) -> dict[str, Any]:
    """Insert a text-only FileCode row and return its summary."""
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
        expired_at=expired_at,
        expired_count=expired_count,
        used_count=0,
        is_chunked=False,
        upload_id=None,
        created_by_ip=ip,
        created_by_ua=ua,
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
) -> dict[str, Any]:
    """Server-write a small file blob then create the FileCode row."""
    if file_size <= 0:
        raise ServiceError("empty_file", code=4001, http_status=400)
    if file_size > SIMPLE_UPLOAD_MAX:
        raise ServiceError(
            "file_too_large_for_simple_upload",
            code=4132,
            http_status=413,
            detail={"max_bytes": SIMPLE_UPLOAD_MAX},
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
    else:
        storage_key = build_storage_key(None, safe)
        import io

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
        created_by_ip=ip,
        created_by_ua=ua,
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
) -> dict[str, Any]:
    """Look up an active share and return a payload pointer for the client.

    Enforces:
        * soft-delete + expiry filters
        * per-IP retrieve-failure tracking (caller's IP banned after threshold)
        * decrements ``expired_count`` and bumps ``used_count`` on success
    """
    # Banned IP? Short-circuit.
    if ip and await retrieve_fail_tracker.is_banned(ip):
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
        if ip:
            n = await retrieve_fail_tracker.record_failure(ip)
            if n >= settings.rate_limit_retrieve_fails_per_hour:
                await retrieve_fail_tracker.ban(
                    ip, settings.retrieve_ban_duration_min * 60
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

    storage = get_storage()

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
            url = await storage.get_object_url(
                sf.file_path,
                ttl=3600,
                response_filename=sf.name if force_dl else None,
            )
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
        if ip:
            await retrieve_fail_tracker.record_success(ip)
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
        if ip:
            await retrieve_fail_tracker.record_success(ip)
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
    url = await storage.get_object_url(
        row.file_path,
        ttl=3600,
        response_filename=row.name if force_dl else None,
    )

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
    if ip:
        await retrieve_fail_tracker.record_success(ip)
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


async def open_download_stream(key: str):
    """Return ``(async-iter, head)`` for the given storage key."""
    storage = get_storage()
    try:
        head = await storage.head(key)
    except FileNotFoundError as exc:
        raise NotFoundError("object_not_found") from exc
    body = await storage.server_read(key)
    return body, head


__all__ = [
    "create_text_share",
    "create_simple_file_share",
    "resolve_share",
    "authorize_download_token",
    "open_download_stream",
    "FORCE_DOWNLOAD_MIMES",
    "SIMPLE_UPLOAD_MAX",
]

# Avoid "imported but unused" complaints from ruff when the module is imported
# for side-effects only.
_ = os
_ = SHA_BUF
