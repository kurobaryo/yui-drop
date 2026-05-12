"""Structured logging via structlog.

* LOG_FORMAT=json (default) emits one JSON object per line — good for shipping.
* LOG_FORMAT=pretty emits a colorised console renderer — good for local dev.

Call ``configure_logging()`` once at app startup, then use ``get_logger(__name__)``.
"""
from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

from .config import settings


def configure_logging() -> None:
    """Wire stdlib logging + structlog. Idempotent — safe to call repeatedly."""
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    # Stdlib root logger writes to stdout; structlog wraps everything above it.
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=level,
        force=True,
    )

    timestamper = structlog.processors.TimeStamper(fmt="iso")

    processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        timestamper,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if settings.log_format == "json":
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer(colors=True))

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(level),
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Return a bound structlog logger. Pass ``__name__`` from the caller."""
    return structlog.get_logger(name)
