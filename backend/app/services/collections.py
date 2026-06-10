"""Collection (shared-room) service layer.

Provides room lifecycle (create / preview / join), member auth, messages
(send / list / delete with creator_only visibility rules), administrative
actions (toggle uploads, close room), and the file-related upload /
download / list / delete primitives.

All public service functions are async and take `db: AsyncSession` first.
None of them commit — callers (routers) own transaction boundaries.

Errors are signalled via `app.services.common.ServiceError` with stable
numeric codes mapped to HTTP statuses at the router layer:

  4040 not_found            (404)  unknown room code or message id
  4041 closed_or_expired    (410)  room is sealed or past its expiry
  4030 forbidden            (403)  bad entry password, self-delete window
                                    elapsed, visibility scope mismatch
  4290 room_full            (429)  max_members reached
  4010 invalid_token        (401)  X-Member-Token does not match the room
"""

from __future__ import annotations

import math
import re
import secrets
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import IO, Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.crypto import generate_dek, wrap_dek
from ..core.logging import get_logger
from ..core.request_ip import mask_ip
from ..core.security import (
    encode_jwt,
    hash_password,
    verify_password,
)
from ..models.collection import Collection
from ..models.collection_file import CollectionFile
from ..models.collection_member import CollectionMember
from ..models.collection_message import CollectionMessage
from ..storage.factory import get_storage
from . import collection_sse, presence
from .common import ServiceError, as_utc

SELF_DELETE_WINDOW = timedelta(minutes=5)


# ── Private helpers ────────────────────────────────────────────────────────


def _utcnow() -> datetime:
    return datetime.now(tz=UTC)


log = get_logger(__name__)


def _ensure_aware(d: datetime) -> datetime:
    """Return ``d`` with UTC tzinfo if it's naive. SQLite's ``DateTime(timezone=True)``
    columns don't preserve tzinfo on read, so values come back naive even
    though we wrote them as aware. Comparing a naive value with a tz-aware
    ``_utcnow()`` raises ``TypeError``; this helper coerces safely."""
    if d.tzinfo is None:
        return d.replace(tzinfo=UTC)
    return d


async def _exists_code(db: AsyncSession, code: str) -> bool:
    res = await db.execute(select(Collection.id).where(Collection.code == code))
    return res.scalar_one_or_none() is not None


async def _load_by_code(db: AsyncSession, code: str) -> Collection:
    res = await db.execute(select(Collection).where(Collection.code == code))
    row = res.scalar_one_or_none()
    if row is None:
        raise ServiceError("not_found", code=4040, http_status=404)
    return row


def _is_closed(c: Collection, *, now: datetime | None = None) -> bool:
    now = now or _utcnow()
    if c.closed_at is not None:
        return True
    if c.expires_at is not None:
        return as_utc(c.expires_at) <= now
    return False


def _message_to_dto(msg: CollectionMessage, nickname: str) -> dict[str, Any]:
    created = as_utc(msg.created_at) if msg.created_at else None
    return {
        "id": msg.id,
        "member_id": msg.member_id,
        "nickname": nickname,
        "body": msg.body,
        "created_at": created.isoformat() if created else None,
    }


def _file_to_dto(row: CollectionFile, nickname: str) -> dict[str, Any]:
    created = as_utc(row.created_at) if row.created_at else None
    return {
        "id": row.id,
        "member_id": row.member_id,
        "nickname": nickname,
        "name": row.name,
        "size": row.size,
        "content_type": row.content_type,
        "created_at": created.isoformat() if created else None,
    }


def _new_member_token() -> str:
    return secrets.token_urlsafe(32)


# ── Room lifecycle ─────────────────────────────────────────────────────────


async def create_collection(
    db: AsyncSession,
    *,
    name: str | None,
    visibility: str,
    entry_password: str | None,
    admin_password: str,
    lifetime_days: int | None,
    permanent: bool,
    created_by_ip: str | None,
    creator_nickname: str | None,
) -> tuple[Collection, CollectionMember | None, str | None]:
    """Create a new room (and optionally auto-join the creator)."""

    async def exists(c: str) -> bool:
        return await _exists_code(db, c)

    # Collection room codes use a "C" prefix + 5 digits to keep them
    # visually and semantically distinct from 6-digit pickup codes. The
    # input field can tell the difference by leading character, so a
    # user can type "234567" (pickup) or "C12345" (room) into the same
    # box without ambiguity.
    import secrets as _secrets

    code = ""
    for _ in range(64):
        cand = "C" + "".join(str(_secrets.randbelow(10)) for _ in range(5))
        if not await exists(cand):
            code = cand
            break
    if not code:
        raise RuntimeError("Exhausted attempts generating a collection code")

    now = _utcnow()
    expires_at: datetime | None
    if permanent:
        expires_at = None
    elif lifetime_days is not None:
        expires_at = now + timedelta(days=int(lifetime_days))
    else:
        expires_at = now + timedelta(days=1)  # default 1 day

    collection = Collection(
        code=code,
        name=name,
        visibility=visibility,
        entry_password_hash=hash_password(entry_password) if entry_password else None,
        admin_password_hash=hash_password(admin_password),
        upload_enabled=True,
        expires_at=expires_at,
        max_members=200,
        created_by_ip=mask_ip(created_by_ip) if created_by_ip else None,
    )
    db.add(collection)
    await db.flush()

    # Always auto-join the creator. Without a member row + token the
    # frontend cannot enter the room it just created (every collection
    # endpoint requires X-Member-Token). nickname defaults to "Owner"
    # if the caller didn't supply one — users can rename later via the
    # in-room nickname change.
    nickname = (creator_nickname or "Owner").strip()[:40] or "Owner"
    token = _new_member_token()
    member = CollectionMember(
        collection_id=collection.id,
        member_token=token,
        nickname=nickname,
        ip_masked=mask_ip(created_by_ip) if created_by_ip else None,
        is_creator=True,
    )
    db.add(member)
    await db.flush()

    return collection, member, token


async def get_collection_by_code(db: AsyncSession, code: str) -> Collection:
    return await _load_by_code(db, code)


async def preview_collection(db: AsyncSession, code: str) -> dict[str, Any]:
    collection = await _load_by_code(db, code)
    member_count = await db.scalar(
        select(func.count(CollectionMember.id)).where(CollectionMember.collection_id == collection.id)
    )
    file_count = await db.scalar(
        select(func.count(CollectionFile.id)).where(
            CollectionFile.collection_id == collection.id,
            CollectionFile.deleted_at.is_(None),
        )
    )
    message_count = await db.scalar(
        select(func.count(CollectionMessage.id)).where(
            CollectionMessage.collection_id == collection.id,
            CollectionMessage.deleted_at.is_(None),
        )
    )
    return {
        "visible": True,
        "closed": _is_closed(collection),
        "has_entry_password": collection.entry_password_hash is not None,
        "name": collection.name,
        "member_count": int(member_count or 0),
        "file_count": int(file_count or 0),
        "message_count": int(message_count or 0),
        "visibility": collection.visibility,
    }


async def join_collection(
    db: AsyncSession,
    *,
    code: str,
    nickname: str,
    entry_password: str | None,
    ip_raw: str | None,
) -> tuple[CollectionMember, str]:
    collection = await _load_by_code(db, code)
    if _is_closed(collection):
        raise ServiceError("closed_or_expired", code=4041, http_status=410)
    if collection.entry_password_hash is not None:
        if not entry_password or not verify_password(entry_password, collection.entry_password_hash):
            raise ServiceError("bad_entry_password", code=4030, http_status=403)
    member_count = (
        await db.scalar(
            select(func.count(CollectionMember.id)).where(CollectionMember.collection_id == collection.id)
        )
        or 0
    )
    if int(member_count) >= collection.max_members:
        raise ServiceError("room_full", code=4290, http_status=429)
    token = _new_member_token()
    member = CollectionMember(
        collection_id=collection.id,
        member_token=token,
        nickname=nickname[:40],
        ip_masked=mask_ip(ip_raw) if ip_raw else None,
        is_creator=False,
    )
    db.add(member)
    await db.flush()
    return member, token


async def get_member_by_token(
    db: AsyncSession, *, code: str, member_token: str
) -> tuple[Collection, CollectionMember]:
    collection = await _load_by_code(db, code)
    if _is_closed(collection):
        raise ServiceError("closed_or_expired", code=4041, http_status=410)
    res = await db.execute(
        select(CollectionMember).where(
            CollectionMember.collection_id == collection.id,
            CollectionMember.member_token == member_token,
        )
    )
    member = res.scalar_one_or_none()
    if member is None:
        raise ServiceError("invalid_token", code=4010, http_status=401)
    # Record the touch in the in-memory presence tracker. The background
    # flush loop (see ``services/presence.py``) batches these into a single
    # short UPDATE every ``FLUSH_INTERVAL_SECONDS``. This is critical for
    # SSE-style polling: doing the UPDATE inline here held the SQLite
    # write lock for the lifetime of the SSE connection (v0.3.4 incident).
    presence.touch(member.id)
    return collection, member


# ── Admin ──────────────────────────────────────────────────────────────────


async def verify_admin_password(db: AsyncSession, *, collection: Collection, admin_password: str) -> bool:
    if not admin_password:
        return False
    return verify_password(admin_password, collection.admin_password_hash)


async def mark_member_creator(db: AsyncSession, member: CollectionMember) -> None:
    if not member.is_creator:
        member.is_creator = True
        await db.flush()


async def admin_toggle_upload(db: AsyncSession, *, collection: Collection, enabled: bool) -> None:
    collection.upload_enabled = bool(enabled)
    await db.flush()
    await collection_sse.broadcast(collection.id, "upload_toggle", {"enabled": bool(enabled)})


async def admin_close(db: AsyncSession, *, collection: Collection) -> None:
    if collection.closed_at is None:
        collection.closed_at = _utcnow()
        await db.flush()
    await collection_sse.broadcast_closed(collection.id)


# ── Messages ───────────────────────────────────────────────────────────────


async def send_message(
    db: AsyncSession,
    *,
    collection: Collection,
    member: CollectionMember,
    text: str,
) -> CollectionMessage:
    msg = CollectionMessage(collection_id=collection.id, member_id=member.id, body=text)
    db.add(msg)
    await db.flush()
    dto = _message_to_dto(msg, member.nickname)
    creator_only = collection.visibility == "creator_only"
    await collection_sse.broadcast(
        collection.id,
        "message",
        dto,
        creator_only=creator_only,
        only_member_id=member.id,
    )
    return msg


async def list_messages(
    db: AsyncSession,
    *,
    collection: Collection,
    member: CollectionMember,
    after_id: int | None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    stmt = (
        select(CollectionMessage, CollectionMember.nickname)
        .join(
            CollectionMember,
            CollectionMember.id == CollectionMessage.member_id,
        )
        .where(
            CollectionMessage.collection_id == collection.id,
            CollectionMessage.deleted_at.is_(None),
        )
        .order_by(CollectionMessage.created_at.asc())
        .limit(max(1, min(int(limit or 50), 200)))
    )
    if after_id:
        stmt = stmt.where(CollectionMessage.id > int(after_id))
    if collection.visibility == "creator_only" and not member.is_creator:
        stmt = stmt.where(CollectionMessage.member_id == member.id)
    res = await db.execute(stmt)
    out: list[dict[str, Any]] = []
    for msg, nickname in res.all():
        out.append(_message_to_dto(msg, nickname or "?"))
    return out


async def delete_message(
    db: AsyncSession,
    *,
    collection: Collection,
    message_id: int,
    by_admin: bool,
    member: CollectionMember | None,
) -> None:
    res = await db.execute(
        select(CollectionMessage).where(
            CollectionMessage.id == message_id,
            CollectionMessage.collection_id == collection.id,
            CollectionMessage.deleted_at.is_(None),
        )
    )
    msg = res.scalar_one_or_none()
    if msg is None:
        raise ServiceError("not_found", code=4040, http_status=404)
    if not by_admin:
        if member is None or member.id != msg.member_id:
            raise ServiceError("forbidden", code=4030, http_status=403)
        created = as_utc(msg.created_at) if msg.created_at else _utcnow()
        if _utcnow() - created > SELF_DELETE_WINDOW:
            raise ServiceError("self_delete_window_elapsed", code=4030, http_status=403)
    msg.deleted_at = _utcnow()
    await db.flush()
    creator_only = collection.visibility == "creator_only"
    await collection_sse.broadcast(
        collection.id,
        "deleted",
        {"kind": "message", "id": msg.id, "member_id": msg.member_id},
        creator_only=creator_only,
        only_member_id=msg.member_id,
    )


# ── Errors ─────────────────────────────────────────────────────────────────


class CollectionFileError(ServiceError):
    """Service-level error with a stable code for Collection file operations."""

    def __init__(self, message: str, http_status: int = 400, *, detail: Any = None) -> None:
        numeric = {
            "file_not_found": 4041,
            "file_not_yet_uploaded": 4042,
            "upload_disabled": 4032,
            "forbidden_not_uploader": 4033,
            "forbidden_creator_only": 4034,
            "delete_window_expired": 4035,
            "empty_file": 4001,
            "invalid_upload_id": 4002,
            "invalid_part_number": 4003,
            "upload_id_mismatch": 4004,
            "missing_parts": 4005,
            "size_mismatch": 4006,
        }.get(message, 4000)
        super().__init__(message, code=numeric, http_status=http_status, detail=detail)


# ── Helpers ────────────────────────────────────────────────────────────────


_LOCAL_CHUNK_DEFAULT = 5 * 1024 * 1024  # 5 MiB
_S3_PART_SIZE = 8 * 1024 * 1024  # 8 MiB (>= S3's 5 MiB multipart minimum)


def _slug(name: str) -> str:
    """Filesystem/key-safe filename slug, ≤ 80 chars."""
    return re.sub(r"[^a-zA-Z0-9._-]", "_", name)[:80] or "file"


def _backend_name() -> str:
    """Normalized current storage-backend name (lowercased).

    Reads the *active* storage singleton's class name rather than the env
    default, so the answer reflects any runtime ``settings_kv`` overlay
    written by the admin UI (e.g. env says ``local`` but admin switched to
    ``s3``). The singleton is primed in the app lifespan via
    :func:`reload_storage` so by the time any request hits this helper, it
    matches what ``get_storage()`` actually returns.
    """
    cls = type(get_storage()).__name__.lower()
    # LocalStorage → local, S3Storage → s3, OneDriveStorage → onedrive, ...
    for name in ("local", "s3", "onedrive", "webdav"):
        if name in cls:
            return name
    return (settings.storage_backend or "local").lower()


def _is_s3_like(backend: str) -> bool:
    """S3, R2, OneDrive, WebDAV all share the presigned-multipart code path."""
    return backend in {"s3", "r2", "onedrive", "webdav"}


def _storage_key(collection: Collection, file_id: int, name: str) -> str:
    return f"collection/{collection.code}/{file_id}-{_slug(name)}"


async def _uploader_nickname(db: AsyncSession, member_id: int) -> str:
    row = (
        await db.execute(select(CollectionMember.nickname).where(CollectionMember.id == member_id))
    ).first()
    return (row[0] if row else None) or ""


def _file_dto(file_row: CollectionFile, nickname: str) -> dict[str, Any]:
    """Shape matches schemas.collection.FileDTO."""
    return {
        "id": file_row.id,
        "member_id": file_row.member_id,
        "nickname": nickname,
        "name": file_row.name,
        "size": file_row.size,
        "content_type": file_row.content_type,
        "created_at": (file_row.created_at.isoformat() if file_row.created_at else ""),
    }


# ── Files (upload state machine) ───────────────────────────────────────────


def _assert_completed(file_row: CollectionFile) -> None:
    if file_row.completed_at is None:
        raise CollectionFileError("file_not_found", 404)


def _assert_upload_session(
    file_row: CollectionFile,
    *,
    member: CollectionMember,
    upload_id: str,
) -> None:
    """Validate member/file/upload binding for follow-up upload calls."""
    if member.id != file_row.member_id:
        raise CollectionFileError("forbidden_not_uploader", 403)
    if not upload_id or file_row.upload_id != upload_id:
        raise CollectionFileError("upload_id_mismatch", 400)
    if file_row.completed_at is not None:
        raise CollectionFileError("file_already_completed", 409)


def _assert_part_number(file_row: CollectionFile, part_number: int, *, s3: bool) -> None:
    total = int(file_row.expected_parts_total or 0)
    if total <= 0:
        raise CollectionFileError("invalid_part_number", 400)
    if s3:
        valid = 1 <= part_number <= total
    else:
        valid = 0 <= part_number < total
    if not valid:
        raise CollectionFileError(
            "invalid_part_number",
            400,
            detail={"part_number": part_number, "parts_total": total},
        )


def _local_tmp_dir(storage: Any, upload_id: str) -> Path:
    tmp_root = getattr(storage, "tmp_root", None)
    if tmp_root is None:
        raise CollectionFileError("local_chunk_upload_not_supported_for_backend", 400)
    root = Path(tmp_root).resolve()
    d = (root / upload_id).resolve()
    if not str(d).startswith(str(root)):
        raise CollectionFileError("invalid_upload_id", 400)
    return d


def _local_part_path(tmp_dir: Path, part_number: int) -> Path:
    part_path = (tmp_dir / f"part_{part_number}").resolve()
    if not str(part_path).startswith(str(tmp_dir.resolve())):
        raise CollectionFileError("invalid_part_number", 400)
    return part_path


async def init_collection_file(
    db: AsyncSession,
    *,
    collection: Collection,
    member: CollectionMember,
    name: str,
    size: int,
    content_type: str | None,
    chunk_size: int | None,
) -> dict[str, Any]:
    """Allocate a pending CollectionFile row and open a backend upload session."""
    if _is_closed(collection):
        raise ServiceError("closed_or_expired", code=4041, http_status=410)
    if not collection.upload_enabled:
        raise CollectionFileError("upload_disabled", 403)
    if size <= 0:
        raise CollectionFileError("empty_file", 400)
    if size > settings.max_upload_bytes:
        raise ServiceError(
            "file_too_large",
            code=4133,
            http_status=413,
            detail={"max_bytes": settings.max_upload_bytes},
        )

    backend_name = _backend_name()
    is_s3 = _is_s3_like(backend_name)
    part_size = _S3_PART_SIZE if is_s3 else (chunk_size or _LOCAL_CHUNK_DEFAULT)
    if part_size <= 0:
        raise CollectionFileError("invalid_part_number", 400)
    total_chunks = max(1, math.ceil(size / part_size))

    row = CollectionFile(
        collection_id=collection.id,
        member_id=member.id,
        name=name[:255],
        size=size,
        storage_key="",  # patched below after id allocation
        storage_backend=backend_name,
        content_type=content_type,
        upload_id=None,
        expected_parts_total=total_chunks,
        part_size=part_size,
        completed_at=None,
        wrapped_dek=None,
    )
    db.add(row)
    await db.flush()

    key = _storage_key(collection, row.id, name)
    storage = get_storage()
    upload_id = await storage.init_multipart(key, content_type)
    row.storage_key = key
    row.upload_id = upload_id
    await db.flush()

    return {
        "upload_id": upload_id,
        "backend": backend_name,
        "total_chunks": total_chunks,
        "part_size": part_size,
        "presigned_part_size": part_size if is_s3 else None,
        "file_id": row.id,
    }


async def sign_collection_file_part(
    db: AsyncSession,
    *,
    collection: Collection,
    file_row: CollectionFile,
    member: CollectionMember,
    upload_id: str,
    part_number: int,
) -> dict[str, Any]:
    """Return a presigned URL for one part of a pending S3-like collection file."""
    _ = db, collection
    backend_name = (file_row.storage_backend or _backend_name()).lower()
    if not _is_s3_like(backend_name):
        raise CollectionFileError("sign_part_not_supported_for_local", 400)
    _assert_upload_session(file_row, member=member, upload_id=upload_id)
    _assert_part_number(file_row, part_number, s3=True)

    storage = get_storage()
    out = await storage.sign_part(file_row.storage_key, upload_id, part_number)
    out["part_number"] = part_number
    return out


async def save_collection_file_part(
    db: AsyncSession,
    *,
    collection: Collection,
    file_row: CollectionFile,
    member: CollectionMember,
    upload_id: str,
    part_number: int,
    fileobj: IO[bytes],
) -> dict[str, Any]:
    """Persist one local-backend chunk after validating upload ownership."""
    _ = db, collection
    backend_name = (file_row.storage_backend or _backend_name()).lower()
    if _is_s3_like(backend_name):
        raise CollectionFileError("local_chunk_upload_not_supported_for_backend", 400)
    _assert_upload_session(file_row, member=member, upload_id=upload_id)
    _assert_part_number(file_row, part_number, s3=False)

    storage = get_storage()
    tmp_dir = _local_tmp_dir(storage, upload_id)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    part_path = _local_part_path(tmp_dir, part_number)

    expected_size = min(
        int(file_row.part_size or _LOCAL_CHUNK_DEFAULT),
        max(0, int(file_row.size) - part_number * int(file_row.part_size or _LOCAL_CHUNK_DEFAULT)),
    )
    max_size = max(1, expected_size)
    written = 0
    with open(part_path, "wb") as out_fp:
        while True:
            chunk = fileobj.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > max_size:
                try:
                    part_path.unlink()
                except FileNotFoundError:
                    pass
                raise CollectionFileError(
                    "size_mismatch",
                    400,
                    detail={"part_number": part_number, "max_bytes": max_size, "actual": written},
                )
            out_fp.write(chunk)

    return {"part_number": part_number, "received": True, "bytes": written}


def _merge_local_parts(tmp_dir: Path, file_row: CollectionFile) -> tuple[Path, int]:
    total_parts = int(file_row.expected_parts_total or 0)
    if total_parts <= 0:
        raise CollectionFileError("missing_parts", 400)
    merged_path = tmp_dir / "_merged.bin"
    total = 0
    with open(merged_path, "wb") as out:
        for i in range(total_parts):
            part_path = _local_part_path(tmp_dir, i)
            if not part_path.exists():
                raise CollectionFileError(
                    "missing_parts",
                    400,
                    detail={"missing_part": i, "expected": total_parts},
                )
            with open(part_path, "rb") as src:
                while True:
                    buf = src.read(1024 * 1024)
                    if not buf:
                        break
                    out.write(buf)
                    total += len(buf)
    return merged_path, total


async def complete_collection_file(
    db: AsyncSession,
    *,
    collection: Collection,
    file_row: CollectionFile,
    member: CollectionMember,
    upload_id: str,
    parts: list[dict[str, Any]],
) -> CollectionFile:
    """Finalize a pending Collection file and make it visible to room members."""
    _assert_upload_session(file_row, member=member, upload_id=upload_id)
    backend_name = (file_row.storage_backend or _backend_name()).lower()
    storage = get_storage()

    if _is_s3_like(backend_name):
        expected = int(file_row.expected_parts_total or 0)
        if len(parts) != expected:
            raise CollectionFileError(
                "missing_parts",
                400,
                detail={"expected": expected, "got": len(parts)},
            )
        await storage.complete_multipart(file_row.storage_key, upload_id, parts)
        head = await storage.head(file_row.storage_key)
        real_size = int(head.get("size") or 0)
        if real_size != int(file_row.size):
            try:
                await storage.delete(file_row.storage_key)
            finally:
                raise CollectionFileError(
                    "size_mismatch",
                    400,
                    detail={"declared": file_row.size, "actual": real_size},
                )
    else:
        tmp_dir = _local_tmp_dir(storage, upload_id)
        if not tmp_dir.exists():
            raise CollectionFileError("missing_parts", 400)
        merged_path, real_size = _merge_local_parts(tmp_dir, file_row)
        if real_size != int(file_row.size):
            await db.flush()
            raise CollectionFileError(
                "size_mismatch",
                400,
                detail={"declared": file_row.size, "actual": real_size},
            )
        dek = generate_dek()
        wrapped = wrap_dek(dek)
        with open(merged_path, "rb") as f:
            await storage.server_write_encrypted(  # type: ignore[attr-defined]
                file_row.storage_key, f, dek
            )
        file_row.wrapped_dek = wrapped
        await db.flush()
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            log.warning("collection local tmp cleanup failed: %s", tmp_dir)

    file_row.completed_at = _utcnow()
    await db.flush()
    await db.refresh(file_row)

    nickname = await _uploader_nickname(db, file_row.member_id)
    payload = _file_dto(file_row, nickname)
    creator_only = (collection.visibility or "public").lower() == "creator_only"
    await collection_sse.broadcast(
        collection.id,
        "file",
        payload,
        creator_only=creator_only,
        only_member_id=file_row.member_id,
    )
    return file_row


async def list_files(
    db: AsyncSession,
    *,
    collection: Collection,
    member: CollectionMember,
) -> list[dict[str, Any]]:
    """Return completed FileDTO dicts visible to ``member``."""
    stmt = (
        select(CollectionFile, CollectionMember.nickname)
        .join(CollectionMember, CollectionMember.id == CollectionFile.member_id)
        .where(
            CollectionFile.collection_id == collection.id,
            CollectionFile.deleted_at.is_(None),
            CollectionFile.completed_at.is_not(None),
        )
        .order_by(CollectionFile.created_at.asc(), CollectionFile.id.asc())
    )
    is_creator_only = (collection.visibility or "public").lower() == "creator_only"
    if is_creator_only and not member.is_creator:
        stmt = stmt.where(CollectionFile.member_id == member.id)

    rows = (await db.execute(stmt)).all()
    return [_file_dto(f, nickname or "") for (f, nickname) in rows]


async def delete_collection_file(
    db: AsyncSession,
    *,
    collection: Collection,
    file_row: CollectionFile,
    by_admin: bool,
    member: CollectionMember | None,
) -> None:
    """Soft-delete a file. Authorization:

    - ``by_admin`` always wins.
    - Otherwise the requester must be the uploader AND act within 5 minutes
      of the upload's ``created_at``.
    """
    if file_row.deleted_at is not None:
        return  # idempotent

    if not by_admin:
        if member is None or member.id != file_row.member_id:
            raise CollectionFileError("forbidden_not_uploader", 403)
        created = file_row.created_at
        if created is not None:
            if created.tzinfo is None:
                created = created.replace(tzinfo=UTC)
            if datetime.now(tz=UTC) - created > timedelta(minutes=5):
                raise CollectionFileError("delete_window_expired", 403)

    file_row.deleted_at = datetime.now(tz=UTC)
    await db.flush()
    await db.commit()

    try:
        storage = get_storage()
        if file_row.completed_at is not None:
            await storage.delete(file_row.storage_key)
        elif file_row.upload_id:
            # Pending upload: best-effort tmp/multipart cleanup.
            if _is_s3_like((file_row.storage_backend or _backend_name()).lower()):
                await storage.abort_multipart(file_row.storage_key, file_row.upload_id)
            else:
                shutil.rmtree(_local_tmp_dir(storage, file_row.upload_id), ignore_errors=True)
    except Exception:
        pass

    creator_only = (collection.visibility or "public").lower() == "creator_only"
    await collection_sse.broadcast(
        collection.id,
        "deleted",
        {"file_id": file_row.id},
        creator_only=creator_only,
        only_member_id=file_row.member_id,
    )


async def get_file_download_url(
    db: AsyncSession,
    *,
    collection: Collection,
    file_row: CollectionFile,
    member: CollectionMember,
) -> tuple[str, int]:
    """Return ``(download_url, ttl_seconds)`` for a completed file."""
    _ = db
    _assert_completed(file_row)
    is_creator_only = (collection.visibility or "public").lower() == "creator_only"
    if is_creator_only and not member.is_creator and file_row.member_id != member.id:
        raise CollectionFileError("forbidden_creator_only", 403)

    ttl = 900
    backend_name = (file_row.storage_backend or _backend_name()).lower()

    if _is_s3_like(backend_name):
        storage = get_storage()
        try:
            await storage.head(file_row.storage_key)
        except Exception as e:
            log.warning(
                "collection file download missed in storage: file_id=%s key=%s err=%s",
                file_row.id,
                file_row.storage_key,
                e,
            )
            raise CollectionFileError("file_not_yet_uploaded", 404) from e
        url = await storage.get_object_url(
            file_row.storage_key, ttl=ttl, response_filename=file_row.name
        )
        return url, ttl

    token_payload: dict[str, Any] = {
        "k": file_row.storage_key,
        "d": file_row.wrapped_dek.hex() if file_row.wrapped_dek else None,
        "fn": file_row.name,
        "fid": file_row.id,
        "cid": collection.id,
    }
    token = encode_jwt(token_payload, expires_in=timedelta(seconds=ttl))
    url = f"/api/collections/{collection.code}/files/{file_row.id}/blob?token={token}"
    return url, ttl


__all__ = [
    "CollectionFileError",
    "init_collection_file",
    "sign_collection_file_part",
    "complete_collection_file",
    "list_files",
    "delete_collection_file",
    "get_file_download_url",
]
