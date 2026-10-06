"""Multi-file share (with an optional note) created through ``/api/v1``.

Lifecycle, all owned by the API key that created the share::

    create_multi()   POST   /api/v1/share/multi
    register_file()  POST   /api/v1/share/multi/{share_id}/files
    upload_part()    POST   /api/v1/share/multi/{share_id}/files/{file_id}/parts/{n}
    complete_file()  POST   /api/v1/share/multi/{share_id}/files/{file_id}/complete
    finalize()       POST   /api/v1/share/multi/{share_id}/finalize
    abort()          DELETE /api/v1/share/multi/{share_id}

The pickup code is reserved at create time but cannot be picked up until
finalize. Unlike the anonymous ``/api/share/multi`` flow there is no upload
token: every step is authorised by the API key alone, and any other key gets
the same 404 as an unknown id.

Parts are relayed through this server in fixed ``PART_SIZE`` chunks:

* **S3-compatible storage** (the live backend has ``upload_part``): each part
  is forwarded to the bucket with a server-side ``UploadPart`` straight from
  memory and its ETag returned; completion lists the parts from the bucket.
  Nothing is staged on local disk.
* **Other backends**: parts are staged under the chunk-upload temp dir and
  merged into storage (encrypted at rest on the local backend) on complete.

The share as a whole lives at most ``V1_MULTIPART_SESSION_TTL_MIN`` from
create to finalize; the retention sweeper reaps it after that. Its expiry
clock is re-based at finalize so a slow upload doesn't eat into the share's
lifetime.
"""
from __future__ import annotations

import asyncio
import hashlib
import math
import shutil
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import aiofiles
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.crypto import generate_dek, unwrap_dek, wrap_dek
from ..core.filenames import sanitize_filename
from ..core.logging import get_logger
from ..core.security import generate_unique_pickup_code
from ..models.access_log import AccessLogAction
from ..models.api_key import ApiKey
from ..models.file_code import FileCode
from ..models.share_file import ShareFile
from ..storage import get_storage
from .api_quota import check_can_upload
from .chunk import _tmp_dir as chunk_tmp_dir
from .common import NotFoundError, ServiceError, as_utc, compute_expiry, record_access
from .share_multi import effective_max_file_bytes, share_total_cap

log = get_logger(__name__)

# Relay part size. S3 needs >= 5 MiB for every part but the last; 6 MiB keeps
# a 10 GiB file well under the 10 000-part limit and each request short.
PART_SIZE = 6 * 1024 * 1024

# ShareFile.upload_id prefixes: which mechanism holds an in-flight file.
_S3 = "s3:"
_LOCAL = "local:"


# ── Small helpers ───────────────────────────────────────────────────────────


def _parse_id(raw: str, missing: str) -> int:
    """Wire ids are opaque strings; ours are positive integers inside."""
    if not raw.isdigit() or len(raw) > 18 or int(raw) <= 0:
        raise NotFoundError(missing)
    return int(raw)


def _part_plan(size: int) -> tuple[int, int]:
    """``(part_size, parts_total)`` for a file of ``size`` bytes."""
    part_size = min(PART_SIZE, size)
    return part_size, math.ceil(size / part_size)


def _expected_part_len(size: int, n: int) -> int:
    part_size, total = _part_plan(size)
    return part_size if n < total else size - (total - 1) * part_size


def session_deadline(row: FileCode) -> datetime:
    """When an unfinalized share stops accepting uploads (and gets reaped)."""
    created = as_utc(row.created_at) or datetime.now(tz=UTC)
    return created + timedelta(minutes=settings.v1_multipart_session_ttl_min)


def _relays_to_s3() -> bool:
    return hasattr(get_storage(), "upload_part")


def _wire_upload_id(internal: str) -> str:
    """Opaque per-file upload handle for the client. The provider's own
    multipart id never leaves the server."""
    return hashlib.sha256(internal.encode()).hexdigest()[:32]


def _staging_dir(sf: ShareFile):
    return chunk_tmp_dir((sf.upload_id or "")[len(_LOCAL):])


def _too_many_files(limit: int, current: int) -> ServiceError:
    return ServiceError(
        "share_file_count_exceeded",
        code=4007,
        http_status=400,
        detail={"max_files": limit, "current_count": current},
    )


def _over_total(cap: int, current: int, new: int) -> ServiceError:
    return ServiceError(
        "share_quota_exceeded",
        code=4007,
        http_status=400,
        detail={"max_total_bytes": cap, "current_total": current, "new_file_size": new},
    )


# ── Loading with ownership ──────────────────────────────────────────────────


async def _load_owned(db: AsyncSession, share_id: str, api_key: ApiKey) -> FileCode:
    """The caller's live multi share, else 404 ``share_not_found``."""
    sid = _parse_id(share_id, "share_not_found")
    row = (
        await db.execute(
            select(FileCode).where(
                FileCode.id == sid,
                FileCode.kind == "multi",
                FileCode.created_by_key_id == api_key.id,
                FileCode.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if row is None:
        raise NotFoundError("share_not_found")
    return row


async def _load_open(db: AsyncSession, share_id: str, api_key: ApiKey) -> FileCode:
    """Like :func:`_load_owned` but the share must still accept uploads."""
    row = await _load_owned(db, share_id, api_key)
    if row.finalized:
        raise ServiceError("share_already_finalized", code=4090, http_status=409)
    if session_deadline(row) <= datetime.now(tz=UTC):
        raise ServiceError("upload_expired", code=4101, http_status=410)
    return row


async def _load_file(db: AsyncSession, share: FileCode, file_id: str) -> ShareFile:
    fid = _parse_id(file_id, "file_not_found")
    sf = (
        await db.execute(
            select(ShareFile).where(ShareFile.id == fid, ShareFile.share_id == share.id)
        )
    ).scalars().first()
    if sf is None:
        raise NotFoundError("file_not_found")
    return sf


# ── 1. create ───────────────────────────────────────────────────────────────


async def create_multi(
    db: AsyncSession,
    *,
    api_key: ApiKey,
    declared_file_count: int,
    declared_total_size: int,
    expire_value: int,
    expire_style: str,
    text: str | None,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Reserve a pickup code for a multi-file share owned by ``api_key``."""
    note = text if text and text.strip() else None
    if note is not None and len(note.encode("utf-8")) > settings.max_text_bytes:
        raise ServiceError(
            "text_too_large", code=4131, http_status=413,
            detail={"max_bytes": settings.max_text_bytes},
        )
    if declared_file_count > settings.max_files_per_share:
        raise _too_many_files(settings.max_files_per_share, declared_file_count)
    cap = await share_total_cap(db)
    if declared_total_size > cap:
        raise _over_total(cap, 0, declared_total_size)

    async def _code_exists(c: str) -> bool:
        q = select(FileCode.id).where(FileCode.code == c, FileCode.deleted_at.is_(None))
        return (await db.execute(q)).first() is not None

    code = await generate_unique_pickup_code(_code_exists)
    now = datetime.now(tz=UTC)
    expired_at, expired_count = compute_expiry(expire_value, expire_style, now=now)

    # One DEK per share when the live backend encrypts at rest (local FS);
    # every member file is encrypted under it, as in the anonymous flow.
    wrapped = wrap_dek(generate_dek()) if hasattr(get_storage(), "server_write_encrypted") else None

    row = FileCode(
        code=code,
        kind="multi",
        text=note,
        expired_at=expired_at,
        expired_count=expired_count,
        finalized=False,
        file_count=0,
        total_size=0,
        is_chunked=True,
        wrapped_dek=wrapped,
        created_by_ip=ip,
        created_by_ua=(ua or "")[:512] or None,
        created_by_key_id=api_key.id,
        # Set here (not by the DB) so the session deadline is known at once.
        created_at=now,
    )
    db.add(row)
    await db.flush()
    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        code=code,
        ip=ip,
        ua=ua,
        extra={
            "event": "v1.multi.create",
            "share_id": row.id,
            "declared_count": declared_file_count,
            "declared_total": declared_total_size,
            "has_note": note is not None,
        },
    )
    await db.commit()
    return {
        "share_id": str(row.id),
        "code": code,
        "expired_at": expired_at.isoformat() if expired_at else None,
        "expired_count": expired_count,
    }


# ── 2. register a file ──────────────────────────────────────────────────────


async def register_file(
    db: AsyncSession,
    *,
    api_key: ApiKey,
    share_id: str,
    name: str,
    size: int,
    content_type: str | None,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    share = await _load_open(db, share_id, api_key)

    max_file = effective_max_file_bytes()
    if size > max_file:
        raise ServiceError(
            "file_too_large", code=4133, http_status=413,
            detail={"max_bytes": max_file, "file_size": size},
        )
    # Per-key limits (4293 per-file size, 4292 daily bytes) apply per file.
    await check_can_upload(db, api_key, file_size=size)

    running_size, running_count, last_order = (
        await db.execute(
            select(
                func.coalesce(func.sum(ShareFile.size), 0),
                func.count(ShareFile.id),
                func.coalesce(func.max(ShareFile.order), 0),
            ).where(ShareFile.share_id == share.id)
        )
    ).one()
    if running_count + 1 > settings.max_files_per_share:
        raise _too_many_files(settings.max_files_per_share, running_count)
    cap = await share_total_cap(db)
    if running_size + size > cap:
        raise _over_total(cap, running_size, size)

    safe = sanitize_filename(name)
    stem, ext = (safe.rsplit(".", 1) if "." in safe else (safe, None))
    suffix = f".{ext}" if ext else None
    file_path = f"multi/{share.id:010d}/{uuid.uuid4().hex}{suffix or ''}"

    if _relays_to_s3():
        provider_id = await get_storage().init_multipart(file_path, content_type=content_type)
        upload_id = _S3 + provider_id
    else:
        upload_id = _LOCAL + f"v1m-{uuid.uuid4().hex}"

    sf = ShareFile(
        share_id=share.id,
        order=int(last_order) + 1,
        name=safe,
        prefix=stem,
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
    if upload_id.startswith(_LOCAL):
        _staging_dir(sf).mkdir(parents=True, exist_ok=True)
    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        code=share.code,
        ip=ip,
        ua=ua,
        extra={"event": "v1.multi.file", "share_id": share.id, "file_id": sf.id, "size": size},
    )
    await db.commit()

    part_size, parts_total = _part_plan(size)
    return {
        "file_id": str(sf.id),
        "upload_id": _wire_upload_id(upload_id),
        "part_size": part_size,
        "parts_total": parts_total,
        "expires_at": session_deadline(share).isoformat(),
    }


# ── 3. one part ─────────────────────────────────────────────────────────────


async def check_part_target(
    db: AsyncSession,
    *,
    api_key: ApiKey,
    share_id: str,
    file_id: str,
    part_number: int,
) -> tuple[FileCode, ShareFile]:
    """Validate a part upload before its body is read (cheap 404 / 4xx)."""
    share = await _load_open(db, share_id, api_key)
    sf = await _load_file(db, share, file_id)
    if sf.state != "uploading" or not sf.upload_id:
        raise ServiceError("file_already_complete", code=4090, http_status=409)
    _part_size, total = _part_plan(sf.size)
    if part_number < 1 or part_number > total:
        raise ServiceError(
            "invalid_part_number", code=4003, http_status=400,
            detail={"part_number": part_number, "parts_total": total},
        )
    return share, sf


async def upload_part(
    db: AsyncSession,
    *,
    share: FileCode,
    sf: ShareFile,
    part_number: int,
    data: bytes,
) -> dict[str, Any]:
    """Store one part (validated by :func:`check_part_target`)."""
    expected = _expected_part_len(sf.size, part_number)
    if len(data) != expected:
        raise ServiceError(
            "invalid_part_size", code=4002, http_status=400,
            detail={"part_number": part_number, "expected": expected, "got": len(data)},
        )
    upload_id = sf.upload_id or ""
    if upload_id.startswith(_S3):
        etag = await get_storage().upload_part(  # type: ignore[attr-defined]
            sf.file_path, upload_id[len(_S3):], part_number, data
        )
        return {"part_number": part_number, "etag": etag or None}

    d = _staging_dir(sf)
    d.mkdir(parents=True, exist_ok=True)
    async with aiofiles.open(d / f"part_{part_number}", "wb") as f:
        await f.write(data)
    return {"part_number": part_number, "etag": None}


# ── 4. complete a file ──────────────────────────────────────────────────────


def _norm_etag(etag: str | None) -> str | None:
    return etag.strip().strip('"') if etag else None


async def complete_file(
    db: AsyncSession,
    *,
    api_key: ApiKey,
    share_id: str,
    file_id: str,
    parts: list[dict[str, Any]],
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Close one file. Returns ``{file_id, name, size, newly_completed}``."""
    share = await _load_open(db, share_id, api_key)
    sf = await _load_file(db, share, file_id)
    if sf.state == "complete":
        return {"file_id": str(sf.id), "name": sf.name, "size": sf.size, "newly_completed": False}

    _part_size, total = _part_plan(sf.size)
    numbers = sorted(int(p["part_number"]) for p in parts)
    if numbers != list(range(1, total + 1)):
        raise ServiceError(
            "parts_count_mismatch", code=4004, http_status=400,
            detail={"expected": total, "got": len(numbers)},
        )

    storage = get_storage()
    upload_id = sf.upload_id or ""
    if upload_id.startswith(_S3):
        provider_id = upload_id[len(_S3):]
        # The bucket's own record is authoritative for sizes and ETags.
        stored = {p["part_number"]: p for p in await storage.list_parts(  # type: ignore[attr-defined]
            sf.file_path, provider_id
        )}
        missing = [
            n for n in numbers
            if n not in stored or stored[n]["size"] != _expected_part_len(sf.size, n)
        ]
        if missing:
            raise ServiceError(
                "missing_parts", code=4004, http_status=400, detail={"missing": missing[:50]},
            )
        for p in parts:
            sent = _norm_etag(p.get("etag"))
            if sent is not None and sent != stored[int(p["part_number"])]["etag"]:
                raise ServiceError(
                    "etag_mismatch", code=4004, http_status=400,
                    detail={"part_number": int(p["part_number"])},
                )
        await storage.complete_multipart(
            sf.file_path,
            provider_id,
            [{"PartNumber": n, "ETag": f'"{stored[n]["etag"]}"'} for n in numbers],
        )
    else:
        d = _staging_dir(sf)
        missing = []
        for n in numbers:
            part = d / f"part_{n}"
            if not part.exists() or part.stat().st_size != _expected_part_len(sf.size, n):
                missing.append(n)
        if missing:
            raise ServiceError(
                "missing_parts", code=4004, http_status=400, detail={"missing": missing[:50]},
            )
        merged = d / "_merged.bin"

        def _merge() -> None:
            with open(merged, "wb") as out:
                for n in numbers:
                    with open(d / f"part_{n}", "rb") as src:
                        shutil.copyfileobj(src, out, 1024 * 1024)

        await asyncio.to_thread(_merge)
        with open(merged, "rb") as f:
            if share.wrapped_dek and hasattr(storage, "server_write_encrypted"):
                await storage.server_write_encrypted(  # type: ignore[attr-defined]
                    sf.file_path, f, unwrap_dek(share.wrapped_dek)
                )
            else:
                await storage.server_write(sf.file_path, f, sf.size)
        await asyncio.to_thread(shutil.rmtree, d, True)

    sf.state = "complete"
    sf.upload_id = None
    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        code=share.code,
        ip=ip,
        ua=ua,
        extra={"event": "v1.multi.file.complete", "share_id": share.id, "file_id": sf.id},
    )
    await db.commit()
    return {"file_id": str(sf.id), "name": sf.name, "size": sf.size, "newly_completed": True}


# ── 5. finalize ─────────────────────────────────────────────────────────────


async def finalize(
    db: AsyncSession,
    *,
    api_key: ApiKey,
    share_id: str,
    ip: str | None,
    ua: str | None,
) -> FileCode:
    """Open the share for pickup. Idempotent: a finalized share is returned
    as-is. Only DB work — no pass over the stored bytes."""
    share = await _load_owned(db, share_id, api_key)
    if share.finalized:
        return share
    now = datetime.now(tz=UTC)
    if session_deadline(share) <= now:
        raise ServiceError("upload_expired", code=4101, http_status=410)

    total_count, total_size, complete_count = (
        await db.execute(
            select(
                func.count(ShareFile.id),
                func.coalesce(func.sum(ShareFile.size), 0),
                func.count(ShareFile.id).filter(ShareFile.state == "complete"),
            ).where(ShareFile.share_id == share.id)
        )
    ).one()
    if total_count == 0:
        raise ServiceError("no_files_registered", code=4090, http_status=409)
    if complete_count != total_count:
        raise ServiceError(
            "incomplete_files", code=4090, http_status=409,
            detail={"complete": complete_count, "total": total_count},
        )

    # Start the share's clock now rather than at create: time spent
    # uploading shouldn't shorten the share.
    if share.expired_at is not None:
        lifetime = as_utc(share.expired_at) - (as_utc(share.created_at) or now)
        share.expired_at = now + lifetime
    share.finalized = True
    share.file_count = int(total_count)
    share.total_size = int(total_size)
    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        code=share.code,
        ip=ip,
        ua=ua,
        extra={
            "event": "v1.multi.finalize",
            "share_id": share.id,
            "file_count": int(total_count),
            "total_size": int(total_size),
        },
    )
    await db.commit()
    return share


# ── 6. abort ────────────────────────────────────────────────────────────────


async def discard_open_share(
    db: AsyncSession,
    share: FileCode,
    *,
    ip: str | None,
    ua: str | None,
    event: str,
) -> None:
    """Remove an unfinalized share completely and commit.

    Aborts in-flight S3 multipart uploads, drops staged parts, deletes the
    objects of files already completed, and hard-deletes the rows so the
    pickup code is free again.
    """
    storage = get_storage()
    files = (
        await db.execute(select(ShareFile).where(ShareFile.share_id == share.id))
    ).scalars().all()
    stored: list[str] = []
    for sf in files:
        upload_id = sf.upload_id or ""
        if sf.state == "complete":
            stored.append(sf.file_path)
        elif upload_id.startswith(_S3):
            try:
                await storage.abort_multipart(sf.file_path, upload_id[len(_S3):])
            except Exception:  # noqa: BLE001 — provider may have reaped it already
                log.warning("v1_multi.abort_multipart_failed", share_id=share.id, file_id=sf.id)
        elif upload_id.startswith(_LOCAL):
            await asyncio.to_thread(shutil.rmtree, _staging_dir(sf), True)
    if stored:
        try:
            await storage.delete_many(stored)
        except Exception:  # noqa: BLE001 — rows go regardless; objects are orphans
            log.warning("v1_multi.delete_objects_failed", share_id=share.id)

    for sf in files:
        await db.delete(sf)
    await record_access(
        db,
        action=AccessLogAction.SHARE_CREATE,
        code=share.code,
        ip=ip,
        ua=ua,
        extra={"event": event, "share_id": share.id, "files": len(files)},
    )
    await db.delete(share)
    await db.commit()


async def abort(
    db: AsyncSession,
    *,
    api_key: ApiKey,
    share_id: str,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Abort an upload; on a finalized share this is a revoke."""
    from .v1_shares import soft_revoke

    share = await _load_owned(db, share_id, api_key)
    wire_id = str(share.id)
    if share.finalized:
        await soft_revoke(db, share, ip=ip, ua=ua, event="v1.multi.abort_finalized")
    else:
        await discard_open_share(db, share, ip=ip, ua=ua, event="v1.multi.abort")
    return {"share_id": wire_id, "aborted": True}


# ── Sweeper hook ────────────────────────────────────────────────────────────


async def reap_expired_open_shares(db: AsyncSession, *, now: datetime) -> int:
    """Discard /api/v1 multi shares never finalized within the session TTL."""
    cutoff = now - timedelta(minutes=settings.v1_multipart_session_ttl_min)
    rows = (
        await db.execute(
            select(FileCode).where(
                FileCode.kind == "multi",
                FileCode.finalized.is_(False),
                FileCode.created_by_key_id.is_not(None),
                FileCode.deleted_at.is_(None),
                FileCode.created_at <= cutoff,
            )
        )
    ).scalars().all()
    for row in rows:
        await discard_open_share(db, row, ip=None, ua=None, event="v1.multi.reaped")
    return len(rows)


__all__ = [
    "PART_SIZE",
    "abort",
    "check_part_target",
    "complete_file",
    "create_multi",
    "discard_open_share",
    "finalize",
    "reap_expired_open_shares",
    "register_file",
    "session_deadline",
    "upload_part",
]
