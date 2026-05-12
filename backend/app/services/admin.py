"""Admin service layer.

Pure business logic for the admin endpoints. Routes in ``app.api.admin``
translate HTTP envelopes to/from these functions; everything that touches
the DB / storage lives here.

Conventions:
* Functions accept primitives + ``AsyncSession`` and return plain dicts.
* Soft-delete is the default; hard-delete is opt-in and dedup-aware
  (file_path may be shared across rows when content-hash de-dup is enabled).
* Every admin mutation appends an ``AccessLog`` row with
  ``action=admin_action`` and an ``extra.event`` discriminator. Caller is
  responsible for the eventual commit (we do commit here for atomicity of
  multi-row deletes — see individual functions).
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.request_ip import AUDIT_IP_KEY, coerce_bool
from ..core.security import hash_password, verify_password
from ..models.access_log import AccessLog, AccessLogAction
from ..models.file_code import FileCode
from ..models.settings_kv import SettingsKV
from ..services.common import NotFoundError, ServiceError, as_utc, record_access
from ..storage import get_storage

# Keys we never echo back from /admin/settings (secrets).
_REDACTED_SETTINGS_KEYS: frozenset[str] = frozenset({"admin_password_hash"})


# ── settings_kv helpers ─────────────────────────────────────────────────────


async def _kv_get(db: AsyncSession, key: str) -> Any:
    """Return the JSON value stored under ``key`` or ``None`` if absent."""
    row = await db.get(SettingsKV, key)
    return row.value if row is not None else None


async def _kv_set(db: AsyncSession, key: str, value: Any) -> None:
    """Upsert one settings_kv row. Does not commit."""
    row = await db.get(SettingsKV, key)
    if row is None:
        row = SettingsKV(key=key, value=value)
        db.add(row)
    else:
        row.value = value


async def _kv_all(db: AsyncSession) -> dict[str, Any]:
    """Return the full settings_kv table as a dict (secrets included — caller filters)."""
    out: dict[str, Any] = {}
    res = await db.execute(select(SettingsKV))
    for row in res.scalars():
        out[row.key] = row.value
    return out


# ── Admin login ─────────────────────────────────────────────────────────────


async def verify_admin_password(db: AsyncSession, plain: str) -> bool:
    """Verify ``plain`` against the current admin credential.

    Resolution order:
      1. ``settings_kv['admin_password_hash']`` (bcrypt) — preferred.
      2. ``settings.admin_token`` plaintext fallback (first-boot bootstrap).

    On a successful plaintext-fallback match, we transparently migrate the
    credential into ``settings_kv['admin_password_hash']`` so subsequent
    verifications never compare plaintext again. Migration is committed by
    the caller via the shared session.
    """
    stored_hash = await _kv_get(db, "admin_password_hash")
    if isinstance(stored_hash, str) and stored_hash:
        return verify_password(plain, stored_hash)

    # Fallback: env-provided ADMIN_TOKEN plaintext compare.
    env_token = settings.admin_token or ""
    if not env_token or plain != env_token:
        return False

    # Auto-migrate: hash the plaintext into settings_kv for future logins.
    await _kv_set(db, "admin_password_hash", hash_password(plain))
    return True


# ── Dashboard ───────────────────────────────────────────────────────────────


async def compute_dashboard(
    db: AsyncSession,
    *,
    startup_time: datetime | None,
) -> dict[str, Any]:
    """Aggregate the numbers shown on the admin dashboard."""
    # totalFiles / storageUsed (active rows only).
    total_files = (
        await db.execute(
            select(func.count(FileCode.id)).where(FileCode.deleted_at.is_(None))
        )
    ).scalar_one()
    storage_used = (
        await db.execute(
            select(func.coalesce(func.sum(FileCode.size), 0)).where(
                FileCode.deleted_at.is_(None)
            )
        )
    ).scalar_one()
    recycled = (
        await db.execute(
            select(func.count(FileCode.id)).where(FileCode.deleted_at.is_not(None))
        )
    ).scalar_one()

    # Uptime — in seconds.
    now = datetime.now(tz=UTC)
    if startup_time is None:
        uptime_seconds = 0
    else:
        uptime_seconds = int((now - as_utc(startup_time)).total_seconds())

    # today / yesterday upload + retrieve counts from access_logs.
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)

    async def _count(action: AccessLogAction, lo: datetime, hi: datetime) -> int:
        res = await db.execute(
            select(func.count(AccessLog.id)).where(
                AccessLog.action == action,
                AccessLog.ts >= lo,
                AccessLog.ts < hi,
            )
        )
        return int(res.scalar_one())

    today_uploads = await _count(AccessLogAction.SHARE_CREATE, today_start, now + timedelta(seconds=1))
    today_retrievals = await _count(AccessLogAction.SHARE_RETRIEVE, today_start, now + timedelta(seconds=1))
    y_uploads = await _count(AccessLogAction.SHARE_CREATE, yesterday_start, today_start)
    y_retrievals = await _count(AccessLogAction.SHARE_RETRIEVE, yesterday_start, today_start)

    return {
        "totalFiles": int(total_files),
        "storageUsed": int(storage_used or 0),
        "recycledFiles": int(recycled),
        "sysUptime": uptime_seconds,
        "today": {"uploads": today_uploads, "retrievals": today_retrievals},
        "yesterday": {"uploads": y_uploads, "retrievals": y_retrievals},
    }


# ── File row presentation ───────────────────────────────────────────────────


def _row_summary(row: FileCode, *, include_audit: bool = False) -> dict[str, Any]:
    """Project a FileCode row into the admin list/get shape.

    ``include_audit`` flips ip/ua visibility — admin list omits them for
    privacy, single-row GET includes them for abuse triage.
    """
    out: dict[str, Any] = {
        "id": row.id,
        "code": row.code,
        "prefix": row.prefix,
        "suffix": row.suffix,
        "name": row.name,
        "size": row.size,
        "is_text": row.text is not None,
        "is_chunked": bool(row.is_chunked),
        "file_hash": row.file_hash,
        "expired_at": as_utc(row.expired_at).isoformat() if row.expired_at else None,
        "expired_count": row.expired_count,
        "used_count": row.used_count,
        "deleted_at": as_utc(row.deleted_at).isoformat() if row.deleted_at else None,
        "created_at": as_utc(row.created_at).isoformat() if row.created_at else None,
    }
    if include_audit:
        out["created_by_ip"] = row.created_by_ip
        out["created_by_ua"] = row.created_by_ua
    return out


# ── File listing ────────────────────────────────────────────────────────────


async def list_files(
    db: AsyncSession,
    *,
    page: int,
    size: int,
    keyword: str | None,
    include_deleted: bool,
) -> dict[str, Any]:
    """Paginated FileCode list with optional keyword + soft-deleted filter."""
    page = max(1, page)
    size = max(1, min(200, size))

    where = []
    if not include_deleted:
        where.append(FileCode.deleted_at.is_(None))
    if keyword:
        like = f"%{keyword}%"
        where.append(or_(FileCode.code.ilike(like), FileCode.name.ilike(like), FileCode.text.ilike(like)))

    base = select(FileCode).where(and_(*where)) if where else select(FileCode)
    total_q = select(func.count(FileCode.id)).where(and_(*where)) if where else select(func.count(FileCode.id))

    total = int((await db.execute(total_q)).scalar_one())
    rows = (
        await db.execute(
            base.order_by(FileCode.id.desc()).offset((page - 1) * size).limit(size)
        )
    ).scalars().all()

    return {
        "items": [_row_summary(r, include_audit=False) for r in rows],
        "total": total,
        "page": page,
        "size": size,
    }


async def get_file(db: AsyncSession, file_id: int) -> dict[str, Any]:
    """Single FileCode row with audit fields exposed."""
    row = await db.get(FileCode, file_id)
    if row is None:
        raise NotFoundError("file_not_found")
    return _row_summary(row, include_audit=True)


async def get_file_by_code(db: AsyncSession, code: str) -> dict[str, Any]:
    """Single FileCode row resolved by its pickup code (active row preferred)."""
    res = await db.execute(
        select(FileCode)
        .where(FileCode.code == code)
        .order_by(FileCode.deleted_at.is_(None).desc(), FileCode.id.desc())
        .limit(1)
    )
    row = res.scalars().first()
    if row is None:
        raise NotFoundError("file_not_found")
    out = _row_summary(row, include_audit=True)
    # Surface a couple of extra fields useful for the admin drawer.
    out["file_path"] = row.file_path
    # Read the *live* storage backend from settings_kv (admin can change at
    # runtime); fall back to the env value when nothing is saved yet.
    from .admin_storage import read_storage_config

    sc = await read_storage_config(db)
    out["storage_backend"] = sc.get("backend") or settings.storage_backend
    return out


async def get_file_row_by_code(db: AsyncSession, code: str) -> FileCode:
    """Return the underlying ``FileCode`` row for ``code`` (active preferred).

    Used by the admin content/download paths which need the raw payload
    rather than the projected dict ``get_file_by_code`` returns.
    """
    res = await db.execute(
        select(FileCode)
        .where(FileCode.code == code)
        .order_by(FileCode.deleted_at.is_(None).desc(), FileCode.id.desc())
        .limit(1)
    )
    row = res.scalars().first()
    if row is None:
        raise NotFoundError("file_not_found")
    return row


async def list_access_log_for_code(
    db: AsyncSession, *, code: str, limit: int = 200
) -> list[dict[str, Any]]:
    """Return up to ``limit`` AccessLog rows for ``code``, newest first."""
    res = await db.execute(
        select(AccessLog)
        .where(AccessLog.code == code)
        .order_by(AccessLog.ts.desc())
        .limit(max(1, min(500, limit)))
    )
    rows = res.scalars().all()
    return [
        {
            "ts": as_utc(r.ts).isoformat() if r.ts else None,
            "action": r.action.value if isinstance(r.action, AccessLogAction) else r.action,
            "ip": r.ip,
            "ua": r.ua,
            "status_code": r.status_code,
            # ``extra`` carries the fine-grained ``event`` discriminator and
            # any per-action metadata. The drawer uses ``extra.reason`` to
            # distinguish an admin preview from a real visitor fetch.
            "extra": r.extra,
        }
        for r in rows
    ]


# ── File mutations ──────────────────────────────────────────────────────────


async def patch_file(
    db: AsyncSession,
    *,
    file_id: int,
    code: str | None,
    prefix: str | None,
    suffix: str | None,
    expired_at: datetime | None,
    expired_count: int | None,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Patch a small whitelist of fields on a FileCode row.

    Raises ``NotFoundError`` for unknown ids and ``ServiceError(code=4090)``
    when ``code`` collides with another active row.
    """
    row = await db.get(FileCode, file_id)
    if row is None:
        raise NotFoundError("file_not_found")

    if code is not None and code != row.code:
        # Collision check against other active rows.
        clash = await db.execute(
            select(FileCode.id).where(
                FileCode.code == code,
                FileCode.id != file_id,
                FileCode.deleted_at.is_(None),
            )
        )
        if clash.first() is not None:
            raise ServiceError(
                "code_conflict", code=4090, http_status=409, detail={"code": code}
            )
        row.code = code

    if prefix is not None:
        row.prefix = prefix
    if suffix is not None:
        row.suffix = suffix
    if prefix is not None or suffix is not None:
        # Keep ``name`` in sync with prefix+suffix for the list view.
        new_prefix = row.prefix or ""
        new_suffix = row.suffix or ""
        row.name = f"{new_prefix}{new_suffix}" or row.name

    if expired_at is not None:
        row.expired_at = expired_at
    if expired_count is not None:
        row.expired_count = expired_count

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        code=row.code,
        ip=ip,
        ua=ua,
        extra={"event": "admin.file.patch", "id": file_id},
    )
    await db.commit()
    await db.refresh(row)
    return _row_summary(row, include_audit=True)


async def restore_file(
    db: AsyncSession,
    *,
    file_id: int,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Clear ``deleted_at`` on a soft-deleted row."""
    row = await db.get(FileCode, file_id)
    if row is None:
        raise NotFoundError("file_not_found")
    row.deleted_at = None
    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        code=row.code,
        ip=ip,
        ua=ua,
        extra={"event": "admin.file.restore", "id": file_id},
    )
    await db.commit()
    await db.refresh(row)
    return _row_summary(row, include_audit=True)


async def _count_file_path_refs(
    db: AsyncSession, *, file_path: str, exclude_id: int
) -> int:
    """Count other rows that still reference ``file_path`` (dedup guard)."""
    res = await db.execute(
        select(func.count(FileCode.id)).where(
            FileCode.file_path == file_path,
            FileCode.id != exclude_id,
        )
    )
    return int(res.scalar_one())


async def delete_file(
    db: AsyncSession,
    *,
    file_id: int,
    hard: bool,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Soft-delete (default) or hard-delete one FileCode row.

    Hard delete removes the bucket object only when no other (active or
    soft-deleted) row references the same ``file_path``.
    """
    row = await db.get(FileCode, file_id)
    if row is None:
        raise NotFoundError("file_not_found")

    if not hard:
        if row.deleted_at is None:
            row.deleted_at = datetime.now(tz=UTC)
        await record_access(
            db,
            action=AccessLogAction.ADMIN_ACTION,
            code=row.code,
            ip=ip,
            ua=ua,
            extra={"event": "admin.file.soft_delete", "id": file_id},
        )
        await db.commit()
        return {"id": file_id, "hard": False}

    # Hard delete.
    file_path = row.file_path
    code = row.code
    freed_bytes = int(row.size or 0) if file_path else 0
    can_delete_blob = False
    if file_path:
        refs = await _count_file_path_refs(db, file_path=file_path, exclude_id=file_id)
        can_delete_blob = refs == 0

    await db.delete(row)
    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        code=code,
        ip=ip,
        ua=ua,
        extra={"event": "admin.file.hard_delete", "id": file_id},
    )
    await db.commit()

    if file_path and can_delete_blob:
        try:
            await get_storage().delete(file_path)
        except Exception:  # noqa: BLE001 — DB row already gone; best effort
            pass
    return {"id": file_id, "hard": True, "freed_bytes": freed_bytes if can_delete_blob else 0}


async def empty_recycle_bin(
    db: AsyncSession,
    *,
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Hard-delete every soft-deleted row, with dedup-aware blob cleanup."""
    rows = (
        await db.execute(select(FileCode).where(FileCode.deleted_at.is_not(None)))
    ).scalars().all()

    # Pre-compute: for each file_path among the rows we're deleting, count
    # references across ALL rows so we know which blobs are safe to evict.
    paths_to_delete: dict[str, int] = {}
    for r in rows:
        if r.file_path:
            paths_to_delete[r.file_path] = paths_to_delete.get(r.file_path, 0) + 1

    safe_blobs: dict[str, int] = {}  # path → freed bytes
    for path in list(paths_to_delete.keys()):
        total_refs = int(
            (
                await db.execute(
                    select(func.count(FileCode.id)).where(FileCode.file_path == path)
                )
            ).scalar_one()
        )
        # Safe to evict iff every reference to this path is among rows we're
        # about to drop. (Soft-deleted rows are still counted here.)
        if total_refs == paths_to_delete[path]:
            # Sum up size from rows referencing this path.
            sz = 0
            for r in rows:
                if r.file_path == path and r.size:
                    sz = int(r.size)  # all dedup siblings share the same size
                    break
            safe_blobs[path] = sz

    freed_bytes = 0
    deleted_count = 0
    storage = get_storage()
    for r in rows:
        await db.delete(r)
        deleted_count += 1
    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=ip,
        ua=ua,
        extra={"event": "admin.recycle.empty", "count": deleted_count},
    )
    await db.commit()

    for path, sz in safe_blobs.items():
        try:
            await storage.delete(path)
            freed_bytes += sz
        except Exception:  # noqa: BLE001 — best effort
            pass

    return {"deleted_count": deleted_count, "freed_bytes": freed_bytes}


# ── Logs ────────────────────────────────────────────────────────────────────


async def list_logs(
    db: AsyncSession,
    *,
    page: int,
    size: int,
    action: str | None,
    ip: str | None,
) -> dict[str, Any]:
    """Paginated access_logs view. ``ip`` is exact-match, ``action`` is enum-filtered."""
    page = max(1, page)
    size = max(1, min(200, size))

    where = []
    if action:
        try:
            where.append(AccessLog.action == AccessLogAction(action))
        except ValueError as e:
            raise ServiceError(
                "invalid_action", code=4001, http_status=400, detail={"action": action}
            ) from e
    if ip:
        where.append(AccessLog.ip == ip)

    base = select(AccessLog).where(and_(*where)) if where else select(AccessLog)
    total_q = (
        select(func.count(AccessLog.id)).where(and_(*where))
        if where
        else select(func.count(AccessLog.id))
    )
    total = int((await db.execute(total_q)).scalar_one())
    rows = (
        await db.execute(
            base.order_by(AccessLog.id.desc()).offset((page - 1) * size).limit(size)
        )
    ).scalars().all()

    items = [
        {
            "id": r.id,
            "ts": as_utc(r.ts).isoformat() if r.ts else None,
            "action": r.action.value if isinstance(r.action, AccessLogAction) else r.action,
            "code": r.code,
            "ip": r.ip,
            "ua": r.ua,
            "status_code": r.status_code,
            "extra": r.extra,
        }
        for r in rows
    ]
    return {"items": items, "total": total, "page": page, "size": size}


# ── Settings ────────────────────────────────────────────────────────────────


async def get_admin_settings(db: AsyncSession) -> dict[str, Any]:
    """Return settings_kv (minus secrets) plus a public env summary."""
    kv = await _kv_all(db)
    safe_kv = {k: v for k, v in kv.items() if k not in _REDACTED_SETTINGS_KEYS}
    # storage.s3.secret_access_key is at-rest-encrypted; always mask it on the wire.
    if "storage.s3.secret_access_key" in safe_kv and safe_kv["storage.s3.secret_access_key"]:
        safe_kv["storage.s3.secret_access_key"] = "****"
    # turnstile_secret_key_enc is also at-rest encrypted; mask on the wire too.
    if "turnstile_secret_key_enc" in safe_kv and safe_kv["turnstile_secret_key_enc"]:
        safe_kv["turnstile_secret_key_enc"] = "****"
    # Default audit toggle = True when the row is absent.
    audit_ip = kv.get(AUDIT_IP_KEY)
    audit_ip_on = coerce_bool(audit_ip, default=True)
    # Surface the *live* storage backend and Turnstile bits using the
    # settings_kv overlay rather than env-only defaults.
    from .admin_storage import read_storage_config
    from .admin_turnstile import read_turnstile_config
    from .admin_uploads import resolve_upload_limits

    sc = await read_storage_config(db)
    ts = await read_turnstile_config(db)
    ul = await resolve_upload_limits(db)
    return {
        "kv": safe_kv,
        "env": {
            "turnstile_enabled": ts["enabled"],
            "turnstile_site_key_present": bool(ts["site_key"]),
            "turnstile_secret_key_present": bool(ts["has_secret"]),
            "storage_backend": sc.get("backend") or settings.storage_backend,
            "app_name": settings.app_name,
            "app_url": settings.app_url,
            "max_upload_bytes": settings.max_upload_bytes,
            "max_text_bytes": settings.max_text_bytes,
            "pickup_code_length": settings.pickup_code_length,
            "audit_log_access_ip": audit_ip_on,
            # Upload-limit overlay (admin-tunable).
            "simple_upload_max_bytes": ul["simple_upload_max_bytes"],
            "chunk_upload_max_bytes": ul["chunk_upload_max_bytes"],
            "multi_total_max_bytes": ul["multi_total_max_bytes"],
            "chunk_upload_enabled": ul["chunk_upload_enabled"],
        },
    }


async def patch_admin_settings(
    db: AsyncSession,
    *,
    updates: dict[str, Any],
    ip: str | None,
    ua: str | None,
) -> dict[str, Any]:
    """Partial-update settings_kv. Special-cases password rotation + turnstile toggle."""
    applied: dict[str, Any] = {}
    for key, val in updates.items():
        if key == "admin_password":
            if not isinstance(val, str) or not val:
                raise ServiceError(
                    "invalid_admin_password", code=4002, http_status=400
                )
            await _kv_set(db, "admin_password_hash", hash_password(val))
            applied["admin_password_hash"] = "<set>"
            continue
        if key == "admin_password_hash":
            # Never accept a raw hash from the wire.
            raise ServiceError(
                "admin_password_hash_immutable_via_api",
                code=4003,
                http_status=400,
            )
        if key == "turnstile_enabled":
            wants_on = bool(val)
            if wants_on:
                # Allow enabling when either the env keys or the
                # settings_kv-stored equivalents are populated. The new
                # ``admin_turnstile`` overlay is preferred — the env keys
                # are kept as a first-boot fallback.
                from .admin_turnstile import resolve_turnstile_config

                cfg = await resolve_turnstile_config(db)
                if not (cfg["site_key"] and cfg["secret_key"]):
                    raise ServiceError(
                        "turnstile_keys_missing",
                        code=4004,
                        http_status=400,
                        detail={"need": ["turnstile_site_key", "turnstile_secret_key"]},
                    )
            await _kv_set(db, "turnstile_enabled", wants_on)
            applied["turnstile_enabled"] = wants_on
            continue
        # Audit-IP toggle. The public API accepts the friendly underscore
        # form (``audit_log_access_ip``) because that is what
        # ``GET /admin/settings`` exposes in its ``env`` block. Internally we
        # store the canonical dotted key from ``AUDIT_IP_KEY`` so that the
        # reader in ``record_access`` and ``_audit_toggle_enabled`` finds it.
        # We also accept the dotted form on the wire for symmetry. Values
        # are normalised through ``coerce_bool`` and stored as a native
        # JSON boolean, matching the round-trip behaviour the
        # ``turnstile_enabled`` row already relies on.
        if key in {"audit_log_access_ip", AUDIT_IP_KEY}:
            normalised = coerce_bool(val, default=True)
            await _kv_set(db, AUDIT_IP_KEY, normalised)
            applied[AUDIT_IP_KEY] = normalised
            continue
        # Default: opaque JSON-blob upsert.
        await _kv_set(db, key, val)
        applied[key] = val

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=ip,
        ua=ua,
        extra={"event": "admin.settings.patch", "keys": list(applied.keys())},
    )
    await db.commit()
    return {"applied": applied}
