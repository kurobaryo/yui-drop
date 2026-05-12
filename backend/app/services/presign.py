"""S3 presigned-URL service.

Drives the multipart-upload state machine:

    init       → CreateMultipartUpload on the bucket, save MultipartSession.
    sign-part  → presigned PUT URL for one part.
    complete   → CompleteMultipartUpload + size sanity-check (>5%
                 mismatch → abort + 4001) + dedup + FileCode insert.
    abort      → AbortMultipartUpload + delete session.
    status     → return uploaded parts list (for client-side resume).

All long-lived state lives in ``multipart_sessions``; the S3 UploadId is
opaque to the client.
"""
from __future__ import annotations

import hashlib
import math
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.filenames import build_storage_key, sanitize_filename
from ..core.security import generate_unique_pickup_code
from ..models.access_log import AccessLogAction
from ..models.file_code import FileCode
from ..models.multipart_session import MultipartSession
from ..storage import get_storage
from .common import NotFoundError, ServiceError, as_utc, compute_expiry, record_access

# S3 hard limit is 10000 parts per upload. We aim for ≤ 9000 to keep
# headroom and avoid edge-case rejections on weird providers.
S3_PART_TARGET_MAX = 9000
S3_PART_MIN_BYTES = 5 * 1024 * 1024  # S3 requires ≥ 5 MiB for non-last parts.
HASH_SKIP_BYTES = 1024 * 1024 * 1024  # ≥ 1 GiB: skip hash (network cost).


def _compute_part_size(file_size: int) -> tuple[int, int]:
    """Return ``(part_size, parts_total)`` for the given file size."""
    if file_size <= 0:
        return S3_PART_MIN_BYTES, 1
    part_size = max(S3_PART_MIN_BYTES, math.ceil(file_size / S3_PART_TARGET_MAX))
    parts_total = max(1, math.ceil(file_size / part_size))
    return part_size, parts_total


async def _code_exists(db: AsyncSession, code: str) -> bool:
    q = select(FileCode.id).where(FileCode.code == code, FileCode.deleted_at.is_(None))
    return (await db.execute(q)).first() is not None


# ────────────────────────────────────────────────────────────────────────────
# init
# ────────────────────────────────────────────────────────────────────────────


async def init_presign_upload(
    db: AsyncSession,
    *,
    file_name: str,
    file_size: int,
    content_type: str | None,
    expire_value: int,
    expire_style: str,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    if file_size <= 0:
        raise ServiceError("empty_file", code=4001, http_status=400)
    if file_size > settings.max_upload_bytes:
        raise ServiceError(
            "file_too_large", code=4133, http_status=413,
            detail={"max_bytes": settings.max_upload_bytes},
        )

    safe = sanitize_filename(file_name)
    key = build_storage_key(None, safe)
    storage = get_storage()
    s3_upload_id = await storage.init_multipart(key, content_type=content_type)

    part_size, parts_total = _compute_part_size(file_size)
    upload_id = uuid.uuid4().hex
    expires_at = datetime.now(tz=UTC) + timedelta(
        minutes=settings.multipart_session_ttl_min
    )

    sess = MultipartSession(
        upload_id=upload_id,
        key=key,
        file_name=safe,
        file_size=file_size,
        content_type=content_type,
        parts_total=parts_total,
        parts_uploaded={},
        s3_upload_id=s3_upload_id,
        expire_value=expire_value,
        expire_style=expire_style,
        created_by_ip=ip,
        expires_at=expires_at,
    )
    db.add(sess)
    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        ip=ip,
        ua=ua,
        extra={
            "event": "presign.init",
            "upload_id": upload_id,
            "key": key,
            "parts_total": parts_total,
            "part_size": part_size,
        },
    )
    await db.commit()
    return {
        "upload_id": upload_id,
        "key": key,
        "part_size": part_size,
        "parts_total": parts_total,
        "s3_upload_id": s3_upload_id,
        "expires_at": expires_at.isoformat(),
    }


# ────────────────────────────────────────────────────────────────────────────
# sign-part
# ────────────────────────────────────────────────────────────────────────────


async def sign_presign_part(
    db: AsyncSession,
    *,
    upload_id: str,
    part_number: int,
) -> dict[str, Any]:
    sess = (
        await db.execute(
            select(MultipartSession).where(MultipartSession.upload_id == upload_id)
        )
    ).scalars().first()
    if sess is None:
        raise NotFoundError("upload_not_found")
    if as_utc(sess.expires_at) <= datetime.now(tz=UTC):
        raise ServiceError("upload_expired", code=4101, http_status=410)
    if part_number < 1 or part_number > sess.parts_total:
        raise ServiceError(
            "invalid_part_number",
            code=4003,
            http_status=400,
            detail={"part_number": part_number, "parts_total": sess.parts_total},
        )

    storage = get_storage()
    res = await storage.sign_part(sess.key, sess.s3_upload_id, part_number, expires_in=3600)
    res["part_number"] = part_number
    return res


# ────────────────────────────────────────────────────────────────────────────
# complete
# ────────────────────────────────────────────────────────────────────────────


async def complete_presign_upload(
    db: AsyncSession,
    *,
    upload_id: str,
    parts: list[dict[str, Any]],
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    sess = (
        await db.execute(
            select(MultipartSession).where(MultipartSession.upload_id == upload_id)
        )
    ).scalars().first()
    if sess is None:
        raise NotFoundError("upload_not_found")

    if len(parts) != sess.parts_total:
        raise ServiceError(
            "parts_count_mismatch",
            code=4004,
            http_status=400,
            detail={"expected": sess.parts_total, "got": len(parts)},
        )

    # Normalize part dicts.
    norm = [
        {"PartNumber": int(p["part_number"]), "ETag": str(p["etag"])}
        for p in parts
    ]
    storage = get_storage()
    await storage.complete_multipart(sess.key, sess.s3_upload_id, norm)

    # Verify real size — bail out on > 5% deviation.
    head = await storage.head(sess.key)
    real_size = int(head.get("size") or 0)
    declared = sess.file_size
    deviation = abs(real_size - declared) / max(1, declared)
    if deviation > 0.05:
        await storage.delete(sess.key)
        await db.delete(sess)
        await db.commit()
        raise ServiceError(
            "size_mismatch",
            code=4001,
            http_status=400,
            detail={"declared": declared, "actual": real_size},
        )

    # Compute hash by streaming back from storage — skip if too large.
    file_hash: str | None = None
    if real_size <= HASH_SKIP_BYTES:
        sha = hashlib.sha256()
        body = await storage.server_read(sess.key)
        async for chunk in body:
            sha.update(chunk)
        file_hash = sha.hexdigest()

    storage_key = sess.key
    dedup = False
    if file_hash:
        existing = (
            await db.execute(
                select(FileCode).where(
                    FileCode.file_hash == file_hash,
                    FileCode.deleted_at.is_(None),
                    FileCode.file_path.is_not(None),
                ).limit(1)
            )
        ).scalars().first()
        if existing is not None and existing.file_path != sess.key:
            # Discard the just-uploaded blob; reuse the existing one.
            await storage.delete(sess.key)
            storage_key = existing.file_path
            dedup = True

    safe = sess.file_name
    prefix = safe.rsplit(".", 1)[0] if "." in safe else safe
    suffix = f".{safe.rsplit('.', 1)[1]}" if "." in safe else None

    expired_at, expired_count = compute_expiry(sess.expire_value, sess.expire_style)
    code = await generate_unique_pickup_code(lambda c: _code_exists(db, c))

    row = FileCode(
        code=code,
        prefix=prefix,
        suffix=suffix,
        name=safe,
        size=real_size,
        file_path=storage_key,
        text=None,
        file_hash=file_hash,
        expired_at=expired_at,
        expired_count=expired_count,
        used_count=0,
        is_chunked=True,
        upload_id=upload_id,
        created_by_ip=ip,
        created_by_ua=ua,
    )
    db.add(row)
    await db.delete(sess)
    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        code=code,
        ip=ip,
        ua=ua,
        extra={
            "event": "presign.complete",
            "upload_id": upload_id,
            "size": real_size,
            "dedup": dedup,
        },
    )
    await db.commit()
    return {"code": code, "name": safe, "size": real_size}


# ────────────────────────────────────────────────────────────────────────────
# abort
# ────────────────────────────────────────────────────────────────────────────


async def abort_presign_upload(
    db: AsyncSession,
    *,
    upload_id: str,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    sess = (
        await db.execute(
            select(MultipartSession).where(MultipartSession.upload_id == upload_id)
        )
    ).scalars().first()
    if sess is None:
        raise NotFoundError("upload_not_found")

    storage = get_storage()
    try:
        await storage.abort_multipart(sess.key, sess.s3_upload_id)
    except Exception:
        # Provider may already have GC'd it — non-fatal.
        pass

    await db.delete(sess)
    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        ip=ip,
        ua=ua,
        extra={"event": "presign.abort", "upload_id": upload_id},
    )
    await db.commit()
    return {"upload_id": upload_id, "aborted": True}


# ────────────────────────────────────────────────────────────────────────────
# status
# ────────────────────────────────────────────────────────────────────────────


async def get_presign_status(db: AsyncSession, *, upload_id: str) -> dict[str, Any]:
    sess = (
        await db.execute(
            select(MultipartSession).where(MultipartSession.upload_id == upload_id)
        )
    ).scalars().first()
    if sess is None:
        raise NotFoundError("upload_not_found")
    parts = sess.parts_uploaded or {}
    uploaded = sorted(int(k) for k in parts.keys() if str(k).isdigit())
    return {
        "upload_id": sess.upload_id,
        "key": sess.key,
        "file_name": sess.file_name,
        "file_size": sess.file_size,
        "parts_total": sess.parts_total,
        "parts_uploaded": uploaded,
        "expires_at": sess.expires_at.isoformat(),
    }
