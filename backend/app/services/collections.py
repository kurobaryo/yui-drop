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
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.crypto import generate_dek, wrap_dek
from ..core.request_ip import mask_ip
from ..core.security import (
    encode_jwt,
    generate_unique_pickup_code,
    hash_password,
    verify_password,
)
from ..models.collection import Collection
from ..models.collection_file import CollectionFile
from ..models.collection_member import CollectionMember
from ..models.collection_message import CollectionMessage
from ..storage.factory import get_storage
from . import collection_sse
from .common import ServiceError, as_utc

SELF_DELETE_WINDOW = timedelta(minutes=5)


# ── Private helpers ────────────────────────────────────────────────────────


def _utcnow() -> datetime:
    return datetime.now(tz=UTC)


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
    # Throttle ``last_seen_at`` writes — under SSE-style polling, every
    # connected client hits this code path every few seconds. Without a gate,
    # each call issues an UPDATE that contends for the SQLite write lock and
    # under load can deadlock the whole room (the symptom we observed in
    # v0.3.3 production: every collection-room message_list / send /
    # files/init returning HTTP 500 "database is locked").
    #
    # We only need ``last_seen_at`` for "online member" UX heuristics, so a
    # 60-second resolution is fine. Compare in-Python rather than via a SQL
    # condition so SQLite doesn't even round-trip for a no-op write.
    now = _utcnow()
    last = member.last_seen_at
    if last is None or (now - _ensure_aware(last)).total_seconds() >= 60:
        member.last_seen_at = now
        await db.flush()
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


class CollectionFileError(Exception):
    """Service-level error with a stable code (mirrors the existing
    NotFoundError / ForbiddenError convention used elsewhere in services/)."""

    def __init__(self, code: str, http_status: int = 400) -> None:
        super().__init__(code)
        self.code = code
        self.http_status = http_status


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


# ── Files (subagent contribution) ──────────────────────────────────────────


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
    """Allocate a CollectionFile row + open a backend multipart session.

    Flow:
      1. Insert row with placeholder storage_key='' so we get a stable id.
      2. Derive storage_key from id + slug.
      3. Call storage.init_multipart(key) → upload_id.
      4. UPDATE storage_key + storage_backend on the row.
      5. Return ``{upload_id, backend, total_chunks, presigned_part_size}``.
    """
    backend_name = _backend_name()
    is_s3 = _is_s3_like(backend_name)
    part_size = _S3_PART_SIZE if is_s3 else (chunk_size or _LOCAL_CHUNK_DEFAULT)
    total_chunks = max(1, math.ceil(size / part_size)) if size > 0 else 1

    # 1. row first → get id
    row = CollectionFile(
        collection_id=collection.id,
        member_id=member.id,
        name=name,
        size=size,
        storage_key="",  # patched below
        storage_backend=backend_name,
        content_type=content_type,
        wrapped_dek=None,
    )
    db.add(row)
    await db.flush()  # populates row.id

    # 2 + 3. build key, open multipart
    key = _storage_key(collection, row.id, name)
    storage = get_storage()
    upload_id = await storage.init_multipart(key, content_type)

    # 4. patch storage_key
    row.storage_key = key
    await db.flush()
    await db.commit()

    return {
        "upload_id": upload_id,
        "backend": backend_name,
        "total_chunks": total_chunks,
        "presigned_part_size": part_size if is_s3 else None,
        # Convenience for the API layer; not part of FileInitResponse but
        # routers need the file id to record subsequent calls.
        "file_id": row.id,
    }


async def sign_collection_file_part(
    db: AsyncSession,
    *,
    collection: Collection,
    file_row: CollectionFile,
    upload_id: str,
    part_number: int,
) -> dict[str, Any]:
    """Presigned-URL wrapper. S3-like backends only — local rejects."""
    backend_name = (file_row.storage_backend or _backend_name()).lower()
    if not _is_s3_like(backend_name):
        # Local backend: the frontend POSTs raw chunk bytes directly to
        # /api/collections/{code}/files/{upload_id}/parts/{n} — there's no
        # presigned URL to mint.
        raise CollectionFileError("sign_part_not_supported_for_local", 400)

    storage = get_storage()
    return await storage.sign_part(file_row.storage_key, upload_id, part_number)


async def complete_collection_file(
    db: AsyncSession,
    *,
    collection: Collection,
    file_row: CollectionFile,
    upload_id: str,
    parts: list[dict[str, Any]],
) -> CollectionFile:
    """Finalize the upload, persist any local-only DEK, broadcast SSE."""
    backend_name = (file_row.storage_backend or _backend_name()).lower()
    storage = get_storage()

    if _is_s3_like(backend_name):
        # Server-side encryption is handled by the bucket (R2 SSE-S3).
        await storage.complete_multipart(file_row.storage_key, upload_id, parts)
        # wrapped_dek stays NULL on the row.
    else:
        # Local backend: the chunk service has already merged the parts to a
        # plaintext temp blob keyed by upload_id. We generate a DEK, write
        # the encrypted blob via server_write_encrypted, and persist the
        # wrapped DEK on the row.
        dek = generate_dek()
        wrapped = wrap_dek(dek)
        # server_write_encrypted is LocalStorage-only — the brief guarantees
        # the current backend exposes it when storage_backend == 'local'.
        await storage.server_write_encrypted(  # type: ignore[attr-defined]
            file_row.storage_key, upload_id, dek
        )
        file_row.wrapped_dek = wrapped

    await db.flush()
    await db.commit()
    await db.refresh(file_row)

    nickname = await _uploader_nickname(db, file_row.member_id)
    payload = {"file": _file_dto(file_row, nickname)}
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
    """Return FileDTO dicts visible to ``member``.

    Visibility:
      - public: everyone in the room sees every undeleted file.
      - creator_only: non-creator members see only their own uploads.
    """
    stmt = (
        select(CollectionFile, CollectionMember.nickname)
        .join(CollectionMember, CollectionMember.id == CollectionFile.member_id)
        .where(
            CollectionFile.collection_id == collection.id,
            CollectionFile.deleted_at.is_(None),
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

    # Best-effort storage delete — swallow errors so an orphaned object
    # doesn't block the soft-delete state from sticking.
    try:
        storage = get_storage()
        await storage.delete(file_row.storage_key)
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
    """Return ``(download_url, ttl_seconds)``.

    - creator_only rooms: non-creators may only download their own uploads;
      raise 4030 otherwise.
    - S3-like backends: presigned GET via storage.get_object_url, ttl=900.
    - Local backend: same-origin token URL ``/api/collections/{code}/files/
      {file_id}/download?token=<jwt>`` carrying the storage_key + wrapped
      DEK + filename, expiring in 15 minutes.
    """
    is_creator_only = (collection.visibility or "public").lower() == "creator_only"
    if is_creator_only and not member.is_creator and file_row.member_id != member.id:
        raise CollectionFileError("forbidden_creator_only", 403)

    ttl = 900  # 15 minutes for both paths
    backend_name = (file_row.storage_backend or _backend_name()).lower()

    if _is_s3_like(backend_name):
        storage = get_storage()
        url = await storage.get_object_url(file_row.storage_key, ttl=ttl, response_filename=file_row.name)
        return url, ttl

    # Local backend → JWT-wrapped same-origin URL.
    token_payload: dict[str, Any] = {
        "k": file_row.storage_key,
        "d": file_row.wrapped_dek.hex() if file_row.wrapped_dek else None,
        "fn": file_row.name,
        "fid": file_row.id,
        "cid": collection.id,
    }
    token = encode_jwt(token_payload, expires_in=timedelta(seconds=ttl))
    url = f"/api/collections/{collection.code}/files/{file_row.id}/download?token={token}"
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
