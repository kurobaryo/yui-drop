"""Storage backend abstraction.

Concrete backends live in sibling modules. Use ``get_storage()`` to obtain the
process-wide singleton selected by ``settings.storage_backend``.

``reload_storage()`` drops the cached singleton and rebuilds it from the
current env + ``settings_kv`` overlay — call it after the admin updates the
storage config at runtime.
"""
from .base import StorageBackend  # noqa: F401
from .factory import get_storage, reload_storage  # noqa: F401

__all__ = ["StorageBackend", "get_storage", "reload_storage"]
