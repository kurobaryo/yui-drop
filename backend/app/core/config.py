"""Application settings loaded from environment / .env.

All keys mirror `.env.example` at the repository root. Secret-bearing fields
(ADMIN_TOKEN, JWT_SECRET, S3_*, TURNSTILE_SECRET_KEY, WEBDAV_PASSWORD,
ONEDRIVE_*_SECRET / *_TOKEN) default to an empty string so the app never ships
with a usable credential baked in.

A single module-level singleton ``settings`` is exposed for easy import:

    from app.core.config import settings
"""
from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Env vars override .env file defaults."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Core ────────────────────────────────────────────────────────────────
    app_url: str = "http://localhost:8000"
    app_name: str = "Yui-Drop"
    allowed_origins: str = "http://localhost:8000"

    # ── Secrets (empty by default; populated from env / install.sh) ────────
    admin_token: str = ""
    jwt_secret: str = ""
    jwt_algorithm: Literal["HS256", "HS384", "HS512"] = "HS256"
    jwt_ttl_days: int = 30
    # AES-256-GCM key for at-rest secrets in settings_kv. Base64url-encoded,
    # must decode to exactly 32 bytes. Generate with:
    #   python -c "import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
    secrets_key: str = ""

    # ── Database ────────────────────────────────────────────────────────────
    database_url: str = "sqlite+aiosqlite:///./data/yui-drop.db"

    # ── Storage backend ─────────────────────────────────────────────────────
    storage_backend: Literal["local", "s3", "onedrive", "webdav"] = "local"
    local_storage_dir: str = "./data/uploads"

    # S3 / S3-compatible (R2, MinIO, ...)
    s3_endpoint_url: str = ""
    s3_bucket_name: str = ""
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    s3_region: str = "auto"
    s3_public_hostname: str = ""

    # OneDrive
    onedrive_client_id: str = ""
    onedrive_client_secret: str = ""
    onedrive_refresh_token: str = ""

    # WebDAV
    webdav_url: str = ""
    webdav_username: str = ""
    webdav_password: str = ""

    # ── Limits & rate limiting ─────────────────────────────────────────────
    pickup_code_length: int = Field(default=6, ge=5, le=8)
    rate_limit_upload_per_min: int = 5
    rate_limit_upload_per_hour: int = 30
    rate_limit_upload_per_day: int = 200
    rate_limit_retrieve_fails_per_hour: int = 20
    retrieve_ban_duration_min: int = 60
    rate_limit_login_per_5min: int = 10
    max_upload_bytes: int = 10 * 1024 * 1024 * 1024  # 10 GiB (legacy alias)
    # Per-file cap for the new multi-file share flow. Independent of
    # ``max_upload_bytes`` so legacy single-file APIs keep their existing
    # behaviour even if operators tune one and not the other.
    max_file_bytes: int = Field(default=10 * 1024 * 1024 * 1024, alias="MAX_FILE_BYTES")
    # Sum-of-files cap for one multi-file share. Default 50 GiB.
    max_share_total_bytes: int = Field(
        default=53687091200, alias="MAX_SHARE_TOTAL_BYTES"
    )
    # File-count cap for one multi-file share.
    max_files_per_share: int = Field(default=200, alias="MAX_FILES_PER_SHARE")
    max_text_bytes: int = 256 * 1024  # 256 KiB
    storage_quota_bytes: int | None = None
    expire_sweeper_interval_min: int = 10
    multipart_session_ttl_min: int = 60

    # ── Bot protection ──────────────────────────────────────────────────────
    turnstile_site_key: str = ""
    turnstile_secret_key: str = ""

    # ── Logging ─────────────────────────────────────────────────────────────
    log_format: Literal["json", "pretty"] = "json"
    log_level: str = "INFO"
    log_access_requests: bool = True

    # ── Frontend build hints (only consumed by vite build) ─────────────────
    vite_public_name: str = ""
    vite_api_base: str = ""

    # ── Derived helpers ─────────────────────────────────────────────────────
    @field_validator("pickup_code_length")
    @classmethod
    def _valid_code_length(cls, v: int) -> int:
        if not 5 <= v <= 8:
            raise ValueError("PICKUP_CODE_LENGTH must be between 5 and 8")
        return v

    @property
    def allowed_origins_list(self) -> list[str]:
        """Parse ALLOWED_ORIGINS as a comma-separated list."""
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def is_https(self) -> bool:
        """True when APP_URL uses the https:// scheme."""
        return self.app_url.lower().startswith("https://")

    @property
    def turnstile_available(self) -> bool:
        return bool(self.turnstile_site_key and self.turnstile_secret_key)


# Module-level singleton. Import as: ``from app.core.config import settings``.
settings = Settings()
