"""SQLAlchemy models package.

Importing this package registers every table on ``Base.metadata``, which is
what Alembic's autogenerate scans.
"""
from .access_log import AccessLog, AccessLogAction
from .api_key import ApiKey
from .api_key_usage import ApiKeyUsage
from .file_code import FileCode
from .multipart_session import MultipartSession
from .oidc_binding import OidcBinding
from .settings_kv import SettingsKV
from .share_file import ShareFile
from .upload_chunk import UploadChunk
from .webauthn_credential import WebauthnCredential

__all__ = [
    "AccessLog",
    "AccessLogAction",
    "ApiKey",
    "ApiKeyUsage",
    "FileCode",
    "MultipartSession",
    "OidcBinding",
    "SettingsKV",
    "ShareFile",
    "UploadChunk",
    "WebauthnCredential",
]
