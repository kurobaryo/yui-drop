"""Chunked-upload service.

Flow (server-proxied; works with any storage backend):

    init       → create MultipartSession row, allocate tmp dir on local FS.
    part(N)    → save the uploaded form-file at tmp/<upload_id>/part_<N>,
                 append N to parts_uploaded JSON.
    status     → return uploaded indices for resume support.
    complete   → concatenate parts → sha256 → storage.server_write → FileCode.
    abort      → reap tmp dir + delete session row.

The tmp dir lives under ``<settings.local_storage_dir>/chunk_tmp/<upload_id>``
regardless of the configured storage backend, since chunks are accumulated
locally before being written to the real backend.
"""
from __future__ import annotations

import asyncio
import hashlib
import shutil
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import aiofiles
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

_CHUNK = 1024 * 1024


def _chunk_tmp_root() -> Path:
    p = Path(settings.local_storage_dir).resolve() / "chunk_tmp"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _tmp_dir(upload_id: str) -> Path:
    root = _chunk_tmp_root()
    d = (root / upload_id).resolve()
    if not str(d).startswith(str(root)):
        raise ValueError("refused traversal")
    return d


async def _code_exists(db: AsyncSession, code: str) -> bool:
    q = select(FileCode.id).where(FileCode.code == code, FileCode.deleted_at.is_(None))
    return (await db.execute(q)).first() is not None


# ────────────────────────────────────────────────────────────────────────────
# init
# ────────────────────────────────────────────────────────────────────────────


async def init_chunk_upload(
    db: AsyncSession,
    *,
    file_name: str,
    file_size: int,
    chunk_size: int,
    file_hash: str | None,
    content_type: str | None,
    expire_value: int,
    expire_style: str,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    # Admin-tunable: chunked-upload kill switch + total-bytes cap. Local
    # import to avoid a circular dependency on the services package.
    from .admin_uploads import resolve_upload_limits

    _limits = await resolve_upload_limits(db)
    if not _limits["chunk_upload_enabled"]:
        raise ServiceError(
            "chunk_upload_disabled",
            code=4030,
            http_status=403,
            detail={"message": "chunk upload disabled"},
        )
    chunk_cap = int(_limits["chunk_upload_max_bytes"])
    if file_size > chunk_cap:
        raise ServiceError(
            "file_too_large", code=4133, http_status=413,
            detail={"max_bytes": chunk_cap},
        )
    if file_size > settings.max_upload_bytes:
        raise ServiceError(
            "file_too_large", code=4133, http_status=413,
            detail={"max_bytes": settings.max_upload_bytes},
        )
    if chunk_size <= 0 or chunk_size > chunk_cap:
        raise ServiceError("invalid_chunk_size", code=4002, http_status=400)

    total_chunks = max(1, (file_size + chunk_size - 1) // chunk_size) if file_size > 0 else 1

    # Resume: if a session with the same file_hash + file_name + file_size is
    # still active, hand back its upload_id and the parts already received.
    if file_hash:
        existing_q = (
            select(MultipartSession)
            .where(
                MultipartSession.file_size == file_size,
                MultipartSession.file_name == sanitize_filename(file_name),
                MultipartSession.expires_at > datetime.now(tz=UTC),
            )
            .limit(5)
        )
        for sess in (await db.execute(existing_q)).scalars().all():
            extra = (sess.parts_uploaded or {})
            if extra.get("__file_hash") == file_hash:
                done = [
                    int(k) for k in extra.keys()
                    if k.isdigit()
                ]
                done.sort()
                return {
                    "upload_id": sess.upload_id,
                    "total_chunks": sess.parts_total,
                    "uploaded_chunks": done,
                    "resumed": True,
                }

    upload_id = uuid.uuid4().hex
    _tmp_dir(upload_id).mkdir(parents=True, exist_ok=True)

    expires_at = datetime.now(tz=UTC) + timedelta(
        minutes=settings.multipart_session_ttl_min
    )
    sess = MultipartSession(
        upload_id=upload_id,
        key="",  # final storage key chosen at complete time
        file_name=sanitize_filename(file_name),
        file_size=file_size,
        content_type=content_type,
        parts_total=total_chunks,
        parts_uploaded={"__file_hash": file_hash} if file_hash else {},
        # MultipartSession requires non-null s3_upload_id; use a sentinel.
        s3_upload_id="local-chunk",
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
            "event": "chunk.init",
            "upload_id": upload_id,
            "file_size": file_size,
            "total_chunks": total_chunks,
        },
    )
    await db.commit()
    return {
        "upload_id": upload_id,
        "total_chunks": total_chunks,
        "uploaded_chunks": [],
        "resumed": False,
    }


# ────────────────────────────────────────────────────────────────────────────
# put one chunk
# ────────────────────────────────────────────────────────────────────────────


async def save_chunk(
    db: AsyncSession,
    *,
    upload_id: str,
    chunk_index: int,
    data: bytes,
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
    if chunk_index < 0 or chunk_index >= sess.parts_total:
        raise ServiceError("invalid_chunk_index", code=4003, http_status=400)

    d = _tmp_dir(upload_id)
    d.mkdir(parents=True, exist_ok=True)
    target = d / f"part_{chunk_index}"
    async with aiofiles.open(target, "wb") as f:
        await f.write(data)

    parts = dict(sess.parts_uploaded or {})
    parts[str(chunk_index)] = f"sz:{len(data)}"
    sess.parts_uploaded = parts
    # mark JSON column dirty for SQLAlchemy
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(sess, "parts_uploaded")
    await db.commit()

    done = sorted(int(k) for k in parts.keys() if k.isdigit())
    return {
        "upload_id": upload_id,
        "chunk_index": chunk_index,
        "uploaded_chunks": done,
        "total_chunks": sess.parts_total,
    }


# ────────────────────────────────────────────────────────────────────────────
# status
# ────────────────────────────────────────────────────────────────────────────


async def get_chunk_status(db: AsyncSession, *, upload_id: str) -> dict[str, Any]:
    sess = (
        await db.execute(
            select(MultipartSession).where(MultipartSession.upload_id == upload_id)
        )
    ).scalars().first()
    if sess is None:
        raise NotFoundError("upload_not_found")
    parts = sess.parts_uploaded or {}
    done = sorted(int(k) for k in parts.keys() if k.isdigit())
    return {
        "upload_id": sess.upload_id,
        "file_name": sess.file_name,
        "file_size": sess.file_size,
        "chunk_size": None,
        "total_chunks": sess.parts_total,
        "uploaded_chunks": done,
        "expires_at": sess.expires_at.isoformat(),
    }


# ────────────────────────────────────────────────────────────────────────────
# complete
# ────────────────────────────────────────────────────────────────────────────


async def complete_chunk_upload(
    db: AsyncSession,
    *,
    upload_id: str,
    expire_value: int,
    expire_style: str,
    ip: str | None,
    ua: str | None,
    # Optional: bypass FileCode row creation (caller manages its own row, e.g.
    # multi-file shares using share_files). When True, this function still
    # writes bytes into storage and cleans up the chunk session, but returns
    # only {key, size, hash} without creating a pickup code.
    skip_filecode_creation: bool = False,
    # Optional: force the storage key (instead of generating one). Used by
    # multi-file shares so the share_files row's file_path matches the
    # actual stored object.
    override_key: str | None = None,
) -> dict[str, Any]:
    sess = (
        await db.execute(
            select(MultipartSession).where(MultipartSession.upload_id == upload_id)
        )
    ).scalars().first()
    if sess is None:
        raise NotFoundError("upload_not_found")

    parts = sess.parts_uploaded or {}
    done = sorted(int(k) for k in parts.keys() if k.isdigit())
    if len(done) != sess.parts_total or done != list(range(sess.parts_total)):
        raise ServiceError(
            "missing_parts", code=4004, http_status=400,
            detail={"expected": sess.parts_total, "got": done},
        )

    d = _tmp_dir(upload_id)
    if not d.exists():
        raise ServiceError("tmp_missing", code=4005, http_status=400)

    # Merge → sha256 → server_write to storage.
    merged_path = d / "_merged.bin"

    def _merge_and_hash() -> tuple[int, str]:
        sha = hashlib.sha256()
        total = 0
        with open(merged_path, "wb") as out:
            for i in done:
                part = d / f"part_{i}"
                with open(part, "rb") as src:
                    while True:
                        buf = src.read(_CHUNK)
                        if not buf:
                            break
                        sha.update(buf)
                        out.write(buf)
                        total += len(buf)
        return total, sha.hexdigest()

    total, sha = await asyncio.to_thread(_merge_and_hash)
    if total != sess.file_size:
        # The declared size and actual bytes diverge — refuse + cleanup.
        await asyncio.to_thread(shutil.rmtree, d, True)
        await db.delete(sess)
        await db.commit()
        raise ServiceError(
            "size_mismatch", code=4001, http_status=400,
            detail={"declared": sess.file_size, "actual": total},
        )

    safe = sess.file_name
    # Dedup by hash.
    existing = (
        await db.execute(
            select(FileCode).where(
                FileCode.file_hash == sha,
                FileCode.deleted_at.is_(None),
                FileCode.file_path.is_not(None),
            ).limit(1)
        )
    ).scalars().first()

    if existing is not None:
        storage_key = existing.file_path
    else:
        # If caller forced a key (multi-file share), use it; else autogenerate.
        storage_key = override_key or build_storage_key(None, safe)
        # Stream merged file into storage.
        with open(merged_path, "rb") as f:
            await get_storage().server_write(storage_key, f, total)

    await asyncio.to_thread(shutil.rmtree, d, True)

    # Caller-managed FileCode (e.g. multi-file share): return key+size, exit.
    if skip_filecode_creation:
        await db.delete(sess)
        await db.commit()
        return {
            "key": storage_key,
            "size": total,
            "hash": sha,
        }

    prefix = safe.rsplit(".", 1)[0] if "." in safe else safe
    suffix = f".{safe.rsplit('.', 1)[1]}" if "." in safe else None
    expired_at, expired_count = compute_expiry(expire_value, expire_style)
    code = await generate_unique_pickup_code(lambda c: _code_exists(db, c))

    row = FileCode(
        code=code,
        prefix=prefix,
        suffix=suffix,
        name=safe,
        size=total,
        file_path=storage_key,
        text=None,
        file_hash=sha,
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
            "event": "chunk.complete",
            "upload_id": upload_id,
            "size": total,
            "name": safe,
            "dedup": existing is not None,
        },
    )
    await db.commit()
    return {"code": code, "name": safe, "size": total}


# ────────────────────────────────────────────────────────────────────────────
# abort
# ────────────────────────────────────────────────────────────────────────────


async def abort_chunk_upload(
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
    d = _tmp_dir(upload_id)
    await asyncio.to_thread(shutil.rmtree, d, True)
    if sess is not None:
        await db.delete(sess)
    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        ip=ip,
        ua=ua,
        extra={"event": "chunk.abort", "upload_id": upload_id},
    )
    await db.commit()
    return {"upload_id": upload_id, "aborted": True}
