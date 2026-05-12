"""Admin storage configuration service.

Read + write the ``storage.*`` rows in ``settings_kv`` that overlay the env
defaults at runtime. Writing an S3 config first attempts a connectivity ping
(``head_bucket``) so we never persist a config we can't actually use.

The ``secret_access_key`` is AES-GCM encrypted via :mod:`app.core.crypto`
before it lands in the DB. On reads, the wire value is always masked to
``"****"`` — never decrypted in a public response.
"""
from __future__ import annotations

from typing import Any

import aioboto3
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.crypto import encrypt_secret
from ..models.settings_kv import SettingsKV
from ..storage import reload_storage
from ..storage.factory import SECRET_KV_KEY
from .common import ServiceError

# settings_kv keys we manage from the storage endpoint.
STORAGE_KEYS = (
    "storage.backend",
    "storage.s3.endpoint_url",
    "storage.s3.bucket_name",
    "storage.s3.access_key_id",
    "storage.s3.region",
    "storage.s3.public_hostname",
    SECRET_KV_KEY,
)

MASK = "****"


async def _kv_get_one(db: AsyncSession, key: str) -> Any:
    row = await db.get(SettingsKV, key)
    return row.value if row is not None else None


async def _kv_set_one(db: AsyncSession, key: str, value: Any) -> None:
    row = await db.get(SettingsKV, key)
    if row is None:
        db.add(SettingsKV(key=key, value=value))
    else:
        row.value = value


async def read_storage_config(db: AsyncSession) -> dict[str, Any]:
    """Return the saved storage config with the secret masked."""
    res = await db.execute(
        select(SettingsKV).where(SettingsKV.key.in_(list(STORAGE_KEYS)))
    )
    raw: dict[str, Any] = {row.key: row.value for row in res.scalars()}
    return {
        "backend": raw.get("storage.backend"),
        "s3": {
            "endpoint_url": raw.get("storage.s3.endpoint_url") or "",
            "bucket_name": raw.get("storage.s3.bucket_name") or "",
            "access_key_id": raw.get("storage.s3.access_key_id") or "",
            "secret_access_key": MASK if raw.get(SECRET_KV_KEY) else "",
            "region": raw.get("storage.s3.region") or "auto",
            "public_hostname": raw.get("storage.s3.public_hostname") or "",
        },
    }


async def _ping_s3(
    *,
    endpoint_url: str,
    bucket_name: str,
    access_key_id: str,
    secret_access_key: str,
    region: str,
) -> None:
    """Raise :class:`ServiceError` if we can't reach the bucket."""
    if not bucket_name:
        raise ServiceError(
            "s3_bucket_required", code=4221, http_status=422,
            detail={"field": "bucket_name"},
        )
    if not access_key_id or not secret_access_key:
        raise ServiceError(
            "s3_credentials_required", code=4222, http_status=422,
            detail={"field": "access_key_id/secret_access_key"},
        )
    session = aioboto3.Session()
    try:
        async with session.client(
            "s3",
            endpoint_url=endpoint_url or None,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name=region or "auto",
        ) as client:
            await client.head_bucket(Bucket=bucket_name)
    except ClientError as exc:
        err = exc.response.get("Error", {}) if hasattr(exc, "response") else {}
        msg = err.get("Message") or str(exc)
        code = err.get("Code") or "ClientError"
        raise ServiceError(
            "s3_ping_failed", code=4223, http_status=422,
            detail={"error_code": code, "message": msg},
        ) from exc
    except BotoCoreError as exc:
        raise ServiceError(
            "s3_ping_failed", code=4224, http_status=422,
            detail={"error_code": "BotoCoreError", "message": str(exc)},
        ) from exc
    except Exception as exc:  # noqa: BLE001 — surface anything else as 422
        raise ServiceError(
            "s3_ping_failed", code=4225, http_status=422,
            detail={"error_code": exc.__class__.__name__, "message": str(exc)},
        ) from exc


async def save_storage_config(
    db: AsyncSession,
    *,
    backend: str,
    s3: dict[str, Any] | None,
) -> dict[str, Any]:
    """Persist a new storage config and reload the active backend.

    For ``backend='s3'`` we ping the bucket first; on failure nothing is
    written and a 422 is raised. ``secret_access_key=None`` means "keep the
    existing encrypted value"; any other value is encrypted before storage.
    Returns the saved config with the secret masked.
    """
    if backend not in ("local", "s3"):
        raise ServiceError(
            "invalid_backend", code=4220, http_status=422,
            detail={"backend": backend, "allowed": ["local", "s3"]},
        )

    if backend == "s3":
        if not s3:
            raise ServiceError(
                "s3_config_required", code=4226, http_status=422,
                detail={"field": "s3"},
            )
        # Resolve the secret: explicit new value > existing encrypted KV.
        new_secret = s3.get("secret_access_key")
        if new_secret is None:
            from ..core.crypto import decrypt_secret  # local to avoid cycle

            existing_enc = await _kv_get_one(db, SECRET_KV_KEY)
            if not isinstance(existing_enc, str) or not existing_enc:
                raise ServiceError(
                    "s3_secret_required", code=4227, http_status=422,
                    detail={"field": "secret_access_key"},
                )
            try:
                effective_secret = decrypt_secret(existing_enc)
            except Exception as exc:
                raise ServiceError(
                    "s3_secret_decrypt_failed", code=4228, http_status=500,
                    detail={"message": str(exc)},
                ) from exc
        else:
            if not isinstance(new_secret, str) or not new_secret:
                raise ServiceError(
                    "s3_secret_required", code=4227, http_status=422,
                    detail={"field": "secret_access_key"},
                )
            effective_secret = new_secret

        await _ping_s3(
            endpoint_url=str(s3.get("endpoint_url") or ""),
            bucket_name=str(s3.get("bucket_name") or ""),
            access_key_id=str(s3.get("access_key_id") or ""),
            secret_access_key=effective_secret,
            region=str(s3.get("region") or "auto"),
        )

        # Ping ok — write everything.
        await _kv_set_one(db, "storage.backend", "s3")
        await _kv_set_one(db, "storage.s3.endpoint_url", str(s3.get("endpoint_url") or ""))
        await _kv_set_one(db, "storage.s3.bucket_name", str(s3.get("bucket_name") or ""))
        await _kv_set_one(db, "storage.s3.access_key_id", str(s3.get("access_key_id") or ""))
        await _kv_set_one(db, "storage.s3.region", str(s3.get("region") or "auto"))
        await _kv_set_one(
            db, "storage.s3.public_hostname", str(s3.get("public_hostname") or "")
        )
        if new_secret is not None:
            await _kv_set_one(db, SECRET_KV_KEY, encrypt_secret(effective_secret))
    else:
        # backend == "local"
        await _kv_set_one(db, "storage.backend", "local")

    await db.commit()
    await reload_storage(db)
    return await read_storage_config(db)


__all__ = [
    "STORAGE_KEYS",
    "read_storage_config",
    "save_storage_config",
]
