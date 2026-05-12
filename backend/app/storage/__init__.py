"""Storage backend abstraction.

Concrete backends live in sibling modules. Use ``get_storage()`` to obtain the
process-wide singleton selected by ``settings.storage_backend``.
"""
from .base import StorageBackend  # noqa: F401
from .factory import get_storage  # noqa: F401

__all__ = ["StorageBackend", "get_storage"]
