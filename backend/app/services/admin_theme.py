"""Admin-tunable site theme (template + appearance + branding).

Stores the whole theme as individual JSON rows in ``settings_kv`` so the admin
can restyle the site at runtime with **no rebuild and no redeploy** — the SPA
reads the resolved theme from ``GET /api/config`` on boot and applies it by
flipping ``data-template`` / ``data-mode`` / ``data-accent`` attributes on
``<html>``.

Keys:
    theme.template        — str slug, which visual template to render
                            (default ``linear``)
    theme.mode            — 'auto' | 'light' | 'dark', the *site default*
                            appearance (default ``auto``); visitors may still
                            override locally unless ``theme.lock_mode`` is set
    theme.accent          — str slug naming an accent within the template,
                            or the literal ``custom`` (default ``''`` → the
                            template's own default accent)
    theme.accent_custom   — '#rrggbb' used when accent == 'custom'
    theme.brand_name      — str, overrides ``settings.app_name`` in the UI
    theme.hero_title      — str, home-page H1 override
    theme.hero_subtitle   — str, home-page sub-headline override
    theme.default_lang    — '' (follow browser) | 'zh-CN' | 'en' | 'ja'
    theme.logo_url        — str URL/path to a custom site icon
    theme.lock_mode       — bool; when true the visitor-side light/dark toggle
                            is hidden and the site default wins (default False)

★ Extensibility contract ★
``template`` and ``accent`` are deliberately stored as **free-form slugs**
validated only for shape (lowercase slug), NOT against a hard-coded whitelist.
Adding a new theme must never require editing this file: the frontend registry
owns the list of renderable templates and falls back to the default when it
sees a slug it doesn't know. Keep it that way.
"""
from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.settings_kv import SettingsKV

# ── settings_kv keys we own ────────────────────────────────────────────────
TEMPLATE_KEY = "theme.template"
MODE_KEY = "theme.mode"
ACCENT_KEY = "theme.accent"
ACCENT_CUSTOM_KEY = "theme.accent_custom"
BRAND_NAME_KEY = "theme.brand_name"
HERO_TITLE_KEY = "theme.hero_title"
HERO_SUBTITLE_KEY = "theme.hero_subtitle"
DEFAULT_LANG_KEY = "theme.default_lang"
LOGO_URL_KEY = "theme.logo_url"
LOCK_MODE_KEY = "theme.lock_mode"

THEME_KEYS = (
    TEMPLATE_KEY,
    MODE_KEY,
    ACCENT_KEY,
    ACCENT_CUSTOM_KEY,
    BRAND_NAME_KEY,
    HERO_TITLE_KEY,
    HERO_SUBTITLE_KEY,
    DEFAULT_LANG_KEY,
    LOGO_URL_KEY,
    LOCK_MODE_KEY,
)

# ── Defaults ───────────────────────────────────────────────────────────────
DEFAULT_TEMPLATE = "linear"
DEFAULT_MODE = "auto"
DEFAULT_ACCENT = ""  # empty → template decides
DEFAULT_ACCENT_CUSTOM = ""
DEFAULT_BRAND_NAME = ""  # empty → fall back to settings.app_name
DEFAULT_HERO_TITLE = ""
DEFAULT_HERO_SUBTITLE = ""
DEFAULT_LANG = ""  # empty → follow the browser
DEFAULT_LOGO_URL = ""
DEFAULT_LOCK_MODE = False

VALID_MODES = frozenset({"auto", "light", "dark"})
VALID_LANGS = frozenset({"", "zh-CN", "en", "ja"})

# Lowercase slug: letters/digits/dash, 1-32 chars. Shape-only validation so new
# templates never require a backend change (see the extensibility note above).
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

# Free-text field cap — keeps a runaway paste out of the config blob that is
# served to every anonymous visitor.
_MAX_TEXT = 200
_MAX_URL = 500


def _coerce_slug(v: Any, default: str) -> str:
    if not isinstance(v, str):
        return default
    s = v.strip().lower()
    if not s:
        return default
    return s if _SLUG_RE.match(s) else default


def _coerce_choice(v: Any, allowed: frozenset[str], default: str) -> str:
    if not isinstance(v, str):
        return default
    s = v.strip()
    return s if s in allowed else default


def _coerce_hex(v: Any, default: str) -> str:
    if not isinstance(v, str):
        return default
    s = v.strip()
    if not s:
        return default
    if not s.startswith("#"):
        s = "#" + s
    return s.lower() if _HEX_RE.match(s) else default


def _coerce_text(v: Any, default: str, limit: int = _MAX_TEXT) -> str:
    if not isinstance(v, str):
        return default
    return v.strip()[:limit]


def _coerce_bool(v: Any, default: bool) -> bool:
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        return v.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _coerce_logo(v: Any, default: str) -> str:
    """Accept only a relative path or an https/data URL for the site icon.

    Rejects ``javascript:`` and friends outright — this value is interpolated
    into an ``<img src>`` on a page served to anonymous visitors.
    """
    if not isinstance(v, str):
        return default
    s = v.strip()[:_MAX_URL]
    if not s:
        return ""
    low = s.lower()
    if low.startswith(("https://", "data:image/", "/")):
        return s
    return default


async def resolve_theme_config(db: AsyncSession) -> dict[str, Any]:
    """Return the active theme, falling back to defaults per key."""
    res = await db.execute(
        select(SettingsKV).where(SettingsKV.key.in_(list(THEME_KEYS)))
    )
    raw: dict[str, Any] = {row.key: row.value for row in res.scalars()}
    return {
        "template": _coerce_slug(raw.get(TEMPLATE_KEY), DEFAULT_TEMPLATE),
        "mode": _coerce_choice(raw.get(MODE_KEY), VALID_MODES, DEFAULT_MODE),
        "accent": _coerce_slug(raw.get(ACCENT_KEY), DEFAULT_ACCENT),
        "accent_custom": _coerce_hex(
            raw.get(ACCENT_CUSTOM_KEY), DEFAULT_ACCENT_CUSTOM
        ),
        "brand_name": _coerce_text(raw.get(BRAND_NAME_KEY), DEFAULT_BRAND_NAME),
        "hero_title": _coerce_text(raw.get(HERO_TITLE_KEY), DEFAULT_HERO_TITLE),
        "hero_subtitle": _coerce_text(
            raw.get(HERO_SUBTITLE_KEY), DEFAULT_HERO_SUBTITLE
        ),
        "default_lang": _coerce_choice(
            raw.get(DEFAULT_LANG_KEY), VALID_LANGS, DEFAULT_LANG
        ),
        "logo_url": _coerce_logo(raw.get(LOGO_URL_KEY), DEFAULT_LOGO_URL),
        "lock_mode": _coerce_bool(raw.get(LOCK_MODE_KEY), DEFAULT_LOCK_MODE),
    }


async def save_theme_config(
    db: AsyncSession,
    *,
    template: str | None = None,
    mode: str | None = None,
    accent: str | None = None,
    accent_custom: str | None = None,
    brand_name: str | None = None,
    hero_title: str | None = None,
    hero_subtitle: str | None = None,
    default_lang: str | None = None,
    logo_url: str | None = None,
    lock_mode: bool | None = None,
) -> dict[str, Any]:
    """Upsert any subset of the theme knobs. Returns the merged, resolved view.

    Every field is optional; ``None`` means "leave the stored row alone". Empty
    strings ARE meaningful for the text fields (they clear an override back to
    the built-in default), so they are persisted rather than skipped.
    """

    async def _set(key: str, value: Any) -> None:
        row = await db.get(SettingsKV, key)
        if row is None:
            db.add(SettingsKV(key=key, value=value))
        else:
            row.value = value

    if template is not None:
        await _set(TEMPLATE_KEY, _coerce_slug(template, DEFAULT_TEMPLATE))
    if mode is not None:
        await _set(MODE_KEY, _coerce_choice(mode, VALID_MODES, DEFAULT_MODE))
    if accent is not None:
        await _set(ACCENT_KEY, _coerce_slug(accent, DEFAULT_ACCENT))
    if accent_custom is not None:
        await _set(
            ACCENT_CUSTOM_KEY, _coerce_hex(accent_custom, DEFAULT_ACCENT_CUSTOM)
        )
    if brand_name is not None:
        await _set(BRAND_NAME_KEY, _coerce_text(brand_name, DEFAULT_BRAND_NAME))
    if hero_title is not None:
        await _set(HERO_TITLE_KEY, _coerce_text(hero_title, DEFAULT_HERO_TITLE))
    if hero_subtitle is not None:
        await _set(
            HERO_SUBTITLE_KEY, _coerce_text(hero_subtitle, DEFAULT_HERO_SUBTITLE)
        )
    if default_lang is not None:
        await _set(
            DEFAULT_LANG_KEY, _coerce_choice(default_lang, VALID_LANGS, DEFAULT_LANG)
        )
    if logo_url is not None:
        await _set(LOGO_URL_KEY, _coerce_logo(logo_url, DEFAULT_LOGO_URL))
    if lock_mode is not None:
        await _set(LOCK_MODE_KEY, bool(lock_mode))

    await db.commit()
    return await resolve_theme_config(db)


__all__ = [
    "THEME_KEYS",
    "TEMPLATE_KEY",
    "MODE_KEY",
    "ACCENT_KEY",
    "ACCENT_CUSTOM_KEY",
    "BRAND_NAME_KEY",
    "HERO_TITLE_KEY",
    "HERO_SUBTITLE_KEY",
    "DEFAULT_LANG_KEY",
    "LOGO_URL_KEY",
    "LOCK_MODE_KEY",
    "DEFAULT_TEMPLATE",
    "DEFAULT_MODE",
    "resolve_theme_config",
    "save_theme_config",
]
