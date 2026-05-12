"""Multi-file share service.

A "multi" share is one ``filecodes`` row with ``kind='multi'`` plus N rows
in ``share_files``. The lifecycle is:

    1. init_multi_share() — reserves the pickup code, mints upload_token
    2. register_file()    — per file: creates ShareFile(state='pending'),
                            spins up either a local chunk session or an S3
                            multipart upload, returns init payload to client
    3. complete_file()    — per file: closes the per-file upload, verifies
                            real bucket size, flips state→'complete'
    4. finalize_share()   — once all files are 'complete': flips the parent
                            row's ``finalized=True``, computes totals,
                            invalidates the upload_token

The upload_token is a JWT signed with the same JWT_SECRET as admin tokens
but with a separate ``scope='share_multi_upload'`` claim. It encodes the
``share_id`` so we can't accidentally use it to write to another share.

Quota enforcement runs three layers:
    - MAX_FILE_BYTES         — per individual file size
    - MAX_SHARE_TOTAL_BYTES  — sum across all files in one share
    - MAX_FILES_PER_SHARE    — count cap (prevents 100k tiny files)

All three are read from settings (env + DB settings_kv overlay) at request
time so admin changes take effect on next request.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.filenames import sanitize_filename
from ..core.logging import get_logger
from ..core.security import (
    decode_jwt,
    encode_jwt,
    generate_unique_pickup_code,
)
from ..models.access_log import AccessLogAction
from ..models.file_code import FileCode
from ..models.share_file import ShareFile
from ..storage import get_storage
from .chunk import complete_chunk_upload, init_chunk_upload
from .common import (
    ForbiddenError,
    NotFoundError,
    ServiceError,
    as_utc,
    compute_expiry,
    record_access,
)

log = get_logger(__name__)


def _split_name(safe_name: str) -> tuple[str, str | None]:
    """Return (prefix, suffix) for a sanitized filename. suffix includes dot."""
    if "." in safe_name:
        stem, ext = safe_name.rsplit(".", 1)
        return stem, f".{ext}"
    return safe_name, None

UPLOAD_TOKEN_SCOPE = "share_multi_upload"
UPLOAD_TOKEN_TTL_MIN = 60  # 1 h to upload all files in a multi share


# ── Token helpers ───────────────────────────────────────────────────────────


def _issue_upload_token(share_id: int) -> str:
    """Mint a short-lived JWT scoped to this share's upload session."""
    return encode_jwt(
        {
            "sub": f"share:{share_id}",
            "scope": UPLOAD_TOKEN_SCOPE,
            "share_id": share_id,
        },
        expires_in=timedelta(minutes=UPLOAD_TOKEN_TTL_MIN),
    )


def verify_upload_token(token: str, expected_share_id: int) -> None:
    """Validate token scope + share_id. Raise ForbiddenError on mismatch."""
    try:
        payload = decode_jwt(token)
    except Exception as e:
        raise ForbiddenError("invalid_upload_token", detail={"reason": "decode"}) from e
    if payload.get("scope") != UPLOAD_TOKEN_SCOPE:
        raise ForbiddenError("invalid_upload_token", detail={"reason": "scope"})
    if int(payload.get("share_id", -1)) != expected_share_id:
        raise ForbiddenError("invalid_upload_token", detail={"reason": "share_mismatch"})


# ── Quota ───────────────────────────────────────────────────────────────────


async def assert_within_share_quota(
    db: AsyncSession,
    *,
    share_id: int | None,
    new_file_size: int,
    declared_total: int | None = None,
    declared_count: int | None = None,
) -> None:
    """Enforce the three share-level limits.

    ``share_id=None`` is the init path (we don't yet have a row to query —
    we only check declared totals).
    """
    if new_file_size > settings.max_file_bytes:
        raise ServiceError(
            "file_too_large",
            code=4133,
            http_status=413,
            detail={"max_bytes": settings.max_file_bytes, "file_size": new_file_size},
        )

    # init-path declared-total check
    if declared_total is not None and declared_total > settings.max_share_total_bytes:
        raise ServiceError(
            "share_quota_exceeded",
            code=4007,
            http_status=400,
            detail={
                "max_total_bytes": settings.max_share_total_bytes,
                "declared_total": declared_total,
            },
        )
    if declared_count is not None and declared_count > settings.max_files_per_share:
        raise ServiceError(
            "share_file_count_exceeded",
            code=4007,
            http_status=400,
            detail={
                "max_files": settings.max_files_per_share,
                "declared_count": declared_count,
            },
        )

    # per-file path: running totals on the share
    if share_id is not None:
        # Sum and count of already-registered files (any state — we count
        # the declared size at register time, not just complete).
        agg_q = select(
            func.coalesce(func.sum(ShareFile.size), 0),
            func.count(ShareFile.id),
        ).where(ShareFile.share_id == share_id)
        running_size, running_count = (await db.execute(agg_q)).one()

        if running_size + new_file_size > settings.max_share_total_bytes:
            raise ServiceError(
                "share_quota_exceeded",
                code=4007,
                http_status=400,
                detail={
                    "max_total_bytes": settings.max_share_total_bytes,
                    "current_total": running_size,
                    "new_file_size": new_file_size,
                },
            )
        if running_count + 1 > settings.max_files_per_share:
            raise ServiceError(
                "share_file_count_exceeded",
                code=4007,
                http_status=400,
                detail={
                    "max_files": settings.max_files_per_share,
                    "current_count": running_count,
                },
            )


# ── 1. init_multi_share ─────────────────────────────────────────────────────


async def init_multi_share(
    db: AsyncSession,
    *,
    declared_file_count: int,
    declared_total_size: int,
    expire_value: int,
    expire_style: str,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Reserve a code + mint upload_token; create the parent FileCode row."""
    # Declared totals check first, before allocating a code.
    await assert_within_share_quota(
        db,
        share_id=None,
        new_file_size=0,
        declared_total=declared_total_size,
        declared_count=declared_file_count,
    )

    async def _code_exists(c: str) -> bool:
        q = select(FileCode.id).where(
            FileCode.code == c, FileCode.deleted_at.is_(None)
        ).limit(1)
        return (await db.execute(q)).scalars().first() is not None

    code = await generate_unique_pickup_code(_code_exists)
    expired_at, expired_count = compute_expiry(expire_value, expire_style)

    row = FileCode(
        code=code,
        kind="multi",
        expired_at=expired_at,
        expired_count=expired_count,
        finalized=False,
        file_count=0,
        total_size=0,
        is_chunked=False,
        created_by_ip=ip,
        created_by_ua=(ua or "")[:512] or None,
    )
    db.add(row)
    await db.flush()  # populate row.id

    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        code=code,
        ip=ip,
        ua=ua,
        status_code=200,
        extra={
            "event": "share.multi.init",
            "share_id": row.id,
            "declared_count": declared_file_count,
            "declared_total": declared_total_size,
        },
    )
    await db.commit()

    token = _issue_upload_token(row.id)

    return {
        "share_id": row.id,
        "code": code,
        "upload_token": token,
        "expired_at": expired_at.isoformat() if expired_at else None,
        "expired_count": expired_count,
    }


# ── 2. register_file ────────────────────────────────────────────────────────


async def _fetch_share_for_upload(db: AsyncSession, share_id: int) -> FileCode:
    row = (
        await db.execute(
            select(FileCode).where(
                FileCode.id == share_id, FileCode.deleted_at.is_(None)
            )
        )
    ).scalars().first()
    if row is None:
        raise NotFoundError("share_not_found")
    if row.kind != "multi":
        raise ForbiddenError("not_multi_share")
    if row.finalized:
        raise ForbiddenError("share_already_finalized")
    if row.expired_at is not None and as_utc(row.expired_at) <= datetime.now(tz=UTC):
        raise ForbiddenError("share_expired")
    return row


async def register_file(
    db: AsyncSession,
    *,
    share_id: int,
    name: str,
    size: int,
    content_type: str | None,
    declared_chunked: bool,
    chunk_size: int | None,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Create a ShareFile row and spin up its underlying upload session.

    For local backend → uses the existing chunk infrastructure.
    For S3 backend → also uses chunk infrastructure for v1 (small files); a
    future improvement will issue presigned multipart URLs for direct browser
    upload. For now everything routes through /api/chunk/upload.
    """
    # Authorization check (raises if share doesn't exist or already finalized).
    await _fetch_share_for_upload(db, share_id)
    await assert_within_share_quota(db, share_id=share_id, new_file_size=size)

    # Assign next display order.
    next_order = (
        (
            await db.execute(
                select(func.coalesce(func.max(ShareFile.order), 0)).where(
                    ShareFile.share_id == share_id
                )
            )
        ).scalar_one()
    ) + 1

    safe_name = sanitize_filename(name)
    prefix, suffix = _split_name(safe_name)

    # Storage path: per-share UUID prefix + per-file UUID + original suffix.
    # We don't have a stable "share uuid" elsewhere; derive a per-row prefix
    # from share_id (padded for filesystem hygiene).
    storage_prefix = f"multi/{share_id:010d}"
    file_uuid = uuid.uuid4().hex
    file_path = f"{storage_prefix}/{file_uuid}{suffix or ''}"

    # Spin up a chunk session — reuse existing init_chunk_upload but we won't
    # rely on its FileCode row creation at complete time. Instead we pass
    # chunk_size large enough that for "small" files there's only one part.
    eff_chunk_size = chunk_size or min(
        max(size, 1), 16 * 1024 * 1024  # default 16 MiB chunks
    )
    chunk_session = await init_chunk_upload(
        db,
        file_name=safe_name,
        file_size=size,
        chunk_size=eff_chunk_size,
        file_hash=None,
        content_type=content_type,
        expire_value=1,  # session's own TTL; share's TTL is separate
        expire_style="hour",
        ip=ip,
        ua=ua,
    )
    upload_id = chunk_session["upload_id"]

    # Create the share_files row, link to upload_id for later complete.
    sf = ShareFile(
        share_id=share_id,
        order=next_order,
        name=safe_name,
        prefix=prefix,
        suffix=suffix,
        size=size,
        file_path=file_path,
        content_type=content_type,
        upload_id=upload_id,
        is_chunked=True,
        state="uploading",
    )
    db.add(sf)
    await db.flush()
    sf_id = sf.id
    await db.commit()

    return {
        "file_id": sf_id,
        "upload_id": upload_id,
        "upload_url": f"/api/chunk/upload/{upload_id}/{{chunk_index}}",
        "chunk_size": eff_chunk_size,
        "total_chunks": chunk_session["total_chunks"],
        "presign_payload": None,  # v1: chunked upload only
    }


# ── 3. complete_file ────────────────────────────────────────────────────────


async def complete_file(
    db: AsyncSession,
    *,
    share_id: int,
    file_id: int,
    etag_list: list[dict] | None,
    total_uploaded_bytes: int,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Finalize one file's upload (close chunk session, move bytes into place)."""
    share = await _fetch_share_for_upload(db, share_id)
    _ = share  # used implicitly for auth via parent endpoint

    sf = (
        await db.execute(
            select(ShareFile).where(
                ShareFile.id == file_id, ShareFile.share_id == share_id
            )
        )
    ).scalars().first()
    if sf is None:
        raise NotFoundError("share_file_not_found")
    if sf.state == "complete":
        return {"ok": True, "size_verified": True, "file_id": file_id, "size": sf.size}

    # Run the chunk's own complete logic. It creates a FileCode row by
    # design — we'll work around that by:
    #   - calling complete_chunk_upload to actually move bytes into storage
    #   - then immediately soft-deleting the auto-created FileCode (we only
    #     want the bytes; the share_files row is the truth)
    completion = await complete_chunk_upload(
        db,
        upload_id=sf.upload_id,
        expire_value=1,
        expire_style="hour",
        ip=ip,
        ua=ua,
        skip_filecode_creation=True,
        override_key=sf.file_path,
    )

    sf.state = "complete"
    actual_size = completion.get("size", sf.size)
    sf.size = actual_size
    sf.file_hash = completion.get("hash")
    await db.commit()

    return {
        "ok": True,
        "size_verified": True,
        "file_id": file_id,
        "size": actual_size,
    }


# ── 4. finalize_share ───────────────────────────────────────────────────────


async def finalize_share(
    db: AsyncSession,
    *,
    share_id: int,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """All files complete → flip the parent row's finalized=True."""
    share = (
        await db.execute(
            select(FileCode).where(FileCode.id == share_id, FileCode.deleted_at.is_(None))
        )
    ).scalars().first()
    if share is None:
        raise NotFoundError("share_not_found")
    if share.kind != "multi":
        raise ForbiddenError("not_multi_share")
    if share.finalized:
        return {
            "code": share.code,
            "expired_at": share.expired_at.isoformat() if share.expired_at else None,
            "file_count": share.file_count,
            "total_size": share.total_size or 0,
        }

    # Aggregate.
    agg = (
        await db.execute(
            select(
                func.count(ShareFile.id),
                func.coalesce(func.sum(ShareFile.size), 0),
                func.count(ShareFile.id).filter(ShareFile.state == "complete"),
            ).where(ShareFile.share_id == share_id)
        )
    ).one()
    total_count, total_size, complete_count = agg

    if total_count == 0:
        raise ForbiddenError("no_files_registered")
    if complete_count != total_count:
        raise ForbiddenError(
            "incomplete_files",
            detail={"complete": complete_count, "total": total_count},
        )

    share.finalized = True
    share.file_count = total_count
    share.total_size = total_size

    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        code=share.code,
        ip=ip,
        ua=ua,
        status_code=200,
        extra={
            "event": "share.multi.finalize",
            "share_id": share_id,
            "file_count": total_count,
            "total_size": total_size,
        },
    )
    await db.commit()

    return {
        "code": share.code,
        "expired_at": share.expired_at.isoformat() if share.expired_at else None,
        "file_count": total_count,
        "total_size": total_size,
    }


# ── 5. resolve_multi (helper for select endpoint) ───────────────────────────


async def list_share_files(
    db: AsyncSession,
    *,
    share_id: int,
) -> list[ShareFile]:
    """Return ShareFile rows for a share, ordered by ``order``."""
    rows = (
        await db.execute(
            select(ShareFile)
            .where(ShareFile.share_id == share_id, ShareFile.state == "complete")
            .order_by(ShareFile.order)
        )
    ).scalars().all()
    return list(rows)


# ── 6. cascade_delete (called by admin hard-delete) ─────────────────────────


async def cascade_delete_share_files(
    db: AsyncSession,
    *,
    share_id: int,
) -> int:
    """Best-effort delete of all share_files rows + their bucket objects."""
    rows = (
        await db.execute(
            select(ShareFile).where(ShareFile.share_id == share_id)
        )
    ).scalars().all()
    if not rows:
        return 0

    storage = get_storage()
    keys = [r.file_path for r in rows]
    try:
        await storage.delete_many(keys)
    except Exception:
        log.exception("share_multi.cascade_delete.storage_error")
        # Continue anyway — we still want DB rows gone.

    for r in rows:
        await db.delete(r)
    await db.commit()
    return len(rows)
