"""Admin authentication endpoints — OIDC and WebAuthn / passkey.

This module is a sibling of :mod:`app.api.admin` so the core admin router
doesn't grow another 500 lines for the auxiliary auth providers. Routes here
share the ``/api/admin`` prefix but live in their own ``APIRouter`` so each
worker can iterate without stepping on the others.

Layout:
    * ``GET  /api/admin/auth/methods``        — public probe (Worker B owns)
    * ``GET  /api/admin/oidc/*``              — OIDC flows (Worker B)
    * ``POST /api/admin/webauthn/register/*`` — passkey registration (this file)
    * ``GET  /api/admin/webauthn/credentials``— list / patch / delete
    * ``POST /api/admin/webauthn/login/*``    — passwordless sign-in
"""

from __future__ import annotations

import base64
import secrets
from datetime import UTC, datetime
from typing import Annotated, Any
from urllib.parse import urlencode

import webauthn
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from ..core.logging import get_logger
from ..core.rate_limit import real_client_ip
from ..core.security import decode_jwt, encode_jwt, issue_admin_token
from ..db.session import get_db
from ..models.access_log import AccessLogAction
from ..models.oidc_binding import OidcBinding
from ..schemas import ok
from ..schemas.admin_oidc import OidcConfigUpdateRequest
from ..schemas.admin_webauthn import (
    WebauthnCredentialPatch,
    WebauthnLoginCompleteRequest,
    WebauthnRegisterCompleteRequest,
)
from ..services.admin_oidc import (
    DEFAULT_PROVIDER_LABEL,
    exchange_code,
    fetch_discovery,
    fetch_jwks,
    read_oidc_config,
    resolve_oidc_config,
    save_oidc_config,
    verify_id_token,
)
from ..services.admin_webauthn import (
    ADMIN_USER_HANDLE,
    ADMIN_USER_NAME,
    CHALLENGE_TTL_SECONDS,
    LOGIN_COOKIE_NAME,
    REGISTER_COOKIE_NAME,
    bump_credential_usage,
    credential_to_dict,
    delete_credential,
    get_credential_by_credential_id,
    insert_credential,
    list_credentials,
    resolve_allowed_origins,
    resolve_rp_id,
    resolve_rp_name,
    sign_challenge_cookie,
    update_credential_label,
    verify_challenge_cookie,
)
from ..services.common import ServiceError, record_access
from .deps import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin-auth"])
log = get_logger(__name__)


# ────────────────────────────────────────────────────────────────────────────
# Auth providers probe + OIDC (Worker B)
# ────────────────────────────────────────────────────────────────────────────

STATE_COOKIE_NAME = "yd_oidc_state"
BIND_COOKIE_NAME = "yd_oidc_bind"
STATE_TTL_SECONDS = 300  # 5 minutes
BIND_TTL_SECONDS = 300


def _service_to_http(exc: ServiceError) -> HTTPException:
    return HTTPException(
        status_code=exc.http_status,
        detail={"code": exc.code, "message": exc.message, "detail": exc.detail},
    )


def _oidc_ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _sign_state(state: str, nonce: str, bind: bool) -> str:
    from datetime import timedelta as _td

    return encode_jwt(
        {"st": state, "nc": nonce, "bn": bool(bind), "kind": "oidc_state"},
        expires_in=_td(seconds=STATE_TTL_SECONDS),
    )


def _verify_state_cookie(cookie_value: str) -> dict[str, Any]:
    try:
        payload = decode_jwt(cookie_value)
    except Exception as exc:
        raise ServiceError(
            "oidc_state_invalid",
            code=4006,
            http_status=400,
        ) from exc
    if payload.get("kind") != "oidc_state":
        raise ServiceError(
            "oidc_state_invalid",
            code=4006,
            http_status=400,
        )
    return payload


def _sign_bind_payload(provider: str, subject: str, email: str | None, name: str | None) -> str:
    from datetime import timedelta as _td

    return encode_jwt(
        {
            "p": provider,
            "s": subject,
            "e": email or "",
            "n": name or "",
            "kind": "oidc_bind",
        },
        expires_in=_td(seconds=BIND_TTL_SECONDS),
    )


def _verify_bind_cookie(cookie_value: str) -> dict[str, Any]:
    try:
        payload = decode_jwt(cookie_value)
    except Exception as exc:
        raise ServiceError(
            "oidc_bind_cookie_invalid",
            code=4007,
            http_status=400,
        ) from exc
    if payload.get("kind") != "oidc_bind":
        raise ServiceError(
            "oidc_bind_cookie_invalid",
            code=4007,
            http_status=400,
        )
    return payload


# ── GET /api/admin/auth/methods ─────────────────────────────────────────────


@router.get("/auth/methods")
async def admin_auth_methods(
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Public probe — tell the login page which auth providers to render.

    Returns ``{password_enabled, webauthn_enabled, oidc_enabled,
    oidc_provider_label}``. ``webauthn_enabled`` is computed safely so the
    probe still works when the WebAuthn migration hasn't been applied
    (Inspector check on the table before counting).
    """
    from ..models.settings_kv import SettingsKV

    pwd_row = await db.get(SettingsKV, "password_login_enabled")
    password_enabled = True
    if pwd_row is not None and pwd_row.value is not None:
        v = pwd_row.value
        if isinstance(v, bool):
            password_enabled = v
        elif isinstance(v, (int, float)):
            password_enabled = bool(v)
        elif isinstance(v, str):
            password_enabled = v.strip().lower() in {"1", "true", "yes", "on"}

    webauthn_enabled = False
    try:
        bind_obj = db.get_bind()

        def _has_table(sync_conn: Any) -> bool:
            return inspect(sync_conn).has_table("webauthn_credentials")

        if hasattr(bind_obj, "run_sync"):
            async with bind_obj.connect() as conn:
                has_table = await conn.run_sync(_has_table)
        else:
            has_table = _has_table(bind_obj)
        if has_table:
            from sqlalchemy import text as _text

            res = await db.execute(_text("SELECT COUNT(*) FROM webauthn_credentials"))
            webauthn_enabled = int(res.scalar() or 0) > 0
    except Exception:
        webauthn_enabled = False

    cfg = await read_oidc_config(db)
    return ok(
        {
            "password_enabled": password_enabled,
            "webauthn_enabled": webauthn_enabled,
            "oidc_enabled": bool(cfg["enabled"]),
            "oidc_provider_label": cfg["provider_label"],
        }
    )


# ── /api/admin/oidc/config (admin-only) ────────────────────────────────────


@router.get("/oidc/config")
async def get_oidc_config(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    return ok(await read_oidc_config(db))


@router.put("/oidc/config")
async def put_oidc_config(
    request: Request,
    body: OidcConfigUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    try:
        cfg = await save_oidc_config(
            db,
            enabled=body.enabled,
            issuer=body.issuer,
            client_id=body.client_id,
            client_secret=body.client_secret,
            scopes=body.scopes,
            redirect_uri=body.redirect_uri,
            provider_label=body.provider_label,
            allow_self_binding=body.allow_self_binding,
        )
    except ServiceError as exc:
        raise _service_to_http(exc) from exc

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ua=_oidc_ua(request),
        extra={
            "event": "admin.oidc.config.update",
            "enabled": cfg["enabled"],
            "provider_label": cfg["provider_label"],
        },
    )
    await db.commit()
    return ok(cfg)


# ── /api/admin/oidc/login (public) ─────────────────────────────────────────


@router.get("/oidc/login")
async def oidc_login(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    bind: int = Query(default=0),
) -> RedirectResponse:
    """Redirect to the IdP's authorize URL with a signed state cookie.

    404 when OIDC is disabled. ``?bind=1`` marks the roundtrip as a
    bind-only flow consumed later by ``POST /api/admin/oidc/bindings``.
    """
    cfg = await resolve_oidc_config(db)
    if not cfg["enabled"]:
        raise HTTPException(status_code=404, detail="oidc_disabled")
    if not cfg["issuer"] or not cfg["client_id"] or not cfg["client_secret"]:
        raise HTTPException(status_code=503, detail="oidc_misconfigured")

    try:
        discovery = await fetch_discovery(cfg["issuer"])
    except ServiceError as exc:
        raise _service_to_http(exc) from exc

    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    cookie_value = _sign_state(state, nonce, bind=bool(bind))

    params = {
        "response_type": "code",
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"],
        "scope": cfg["scopes"],
        "state": state,
        "nonce": nonce,
    }
    target = f"{discovery['authorization_endpoint']}?{urlencode(params)}"
    resp = RedirectResponse(url=target, status_code=302)
    resp.set_cookie(
        STATE_COOKIE_NAME,
        cookie_value,
        max_age=STATE_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )
    return resp


@router.get("/oidc/callback")
async def oidc_callback(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    state_cookie: Annotated[str | None, Cookie(alias=STATE_COOKIE_NAME)] = None,
) -> RedirectResponse:
    """Handle the IdP redirect, mint an admin JWT, hand control back to the SPA.

    Bind flow: stash the validated identity in a 5min cookie and redirect to
    ``/admin/oidc/bound`` so the popup can postMessage back to the opener.
    Login flow: look up ``(provider, subject)`` in ``oidc_bindings``; on hit,
    mint an admin JWT and redirect to ``/admin/oidc/callback?token=...``;
    on miss, redirect to ``/admin/login?oidc_error=not_bound``.
    """
    cfg = await resolve_oidc_config(db)
    if not cfg["enabled"]:
        raise HTTPException(status_code=404, detail="oidc_disabled")

    app_url = cfg["redirect_uri"].rsplit("/admin/oidc/callback", 1)[0] or "/"

    def _err_redirect(reason: str) -> RedirectResponse:
        url = f"{app_url}/admin/login?oidc_error={reason}"
        out = RedirectResponse(url=url, status_code=302)
        out.delete_cookie(STATE_COOKIE_NAME, path="/")
        return out

    if error:
        return _err_redirect(error[:64])
    if not code or not state:
        return _err_redirect("missing_code")
    if not state_cookie:
        return _err_redirect("missing_state_cookie")

    try:
        state_payload = _verify_state_cookie(state_cookie)
    except ServiceError:
        return _err_redirect("bad_state")
    if state_payload.get("st") != state:
        return _err_redirect("bad_state")

    nonce = state_payload.get("nc")
    is_bind_flow = bool(state_payload.get("bn"))

    try:
        discovery = await fetch_discovery(cfg["issuer"])
        tokens = await exchange_code(
            token_endpoint=discovery["token_endpoint"],
            code=code,
            client_id=cfg["client_id"],
            client_secret=cfg["client_secret"],
            redirect_uri=cfg["redirect_uri"],
        )
        id_token = tokens.get("id_token")
        if not id_token:
            return _err_redirect("no_id_token")

        jwks = await fetch_jwks(discovery["jwks_uri"])
        claims = verify_id_token(
            id_token=id_token,
            jwks=jwks,
            issuer=cfg["issuer"],
            audience=cfg["client_id"],
            nonce=nonce,
        )
    except ServiceError as exc:
        log.warning("oidc.callback.verify_failed", message=exc.message)
        return _err_redirect(exc.message)

    provider = cfg["provider_label"]
    subject = str(claims["sub"])
    email = claims.get("email")
    display_name = claims.get("name") or claims.get("preferred_username")

    if is_bind_flow:
        bind_cookie_value = _sign_bind_payload(provider, subject, email, display_name)
        resp = RedirectResponse(url=f"{app_url}/admin/oidc/bound", status_code=302)
        resp.set_cookie(
            BIND_COOKIE_NAME,
            bind_cookie_value,
            max_age=BIND_TTL_SECONDS,
            httponly=True,
            samesite="lax",
            secure=request.url.scheme == "https",
            path="/",
        )
        resp.delete_cookie(STATE_COOKIE_NAME, path="/")
        return resp

    res = await db.execute(
        select(OidcBinding).where(OidcBinding.provider == provider).where(OidcBinding.subject == subject)
    )
    binding = res.scalar_one_or_none()
    if binding is None:
        await record_access(
            db,
            action=AccessLogAction.ADMIN_ACTION,
            ua=_oidc_ua(request),
            status_code=401,
            extra={
                "event": "admin.oidc.login.not_bound",
                "provider": provider,
                "subject": subject,
            },
        )
        await db.commit()
        return _err_redirect("not_bound")

    binding.email = email or binding.email
    binding.display_name = display_name or binding.display_name
    binding.last_login_at = datetime.now(tz=UTC)
    token, expires_at = issue_admin_token(subject=f"oidc:{provider}:{subject}")
    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ua=_oidc_ua(request),
        status_code=200,
        extra={
            "event": "admin.oidc.login.success",
            "provider": provider,
            "binding_id": binding.id,
        },
    )
    await db.commit()

    qs = urlencode({"token": token, "expires_at": expires_at.isoformat()})
    resp = RedirectResponse(
        url=f"{app_url}/admin/oidc/callback?{qs}",
        status_code=302,
    )
    resp.delete_cookie(STATE_COOKIE_NAME, path="/")
    return resp


# ── /api/admin/oidc/bindings (admin-only) ──────────────────────────────────


def _serialize_binding(row: OidcBinding) -> dict[str, Any]:
    return {
        "id": row.id,
        "provider": row.provider,
        "subject": row.subject,
        "email": row.email,
        "display_name": row.display_name,
        "created_at": row.created_at.isoformat(),
        "last_login_at": row.last_login_at.isoformat() if row.last_login_at else None,
    }


@router.get("/oidc/bindings")
async def list_oidc_bindings(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    res = await db.execute(select(OidcBinding).order_by(OidcBinding.created_at.desc()))
    return ok({"items": [_serialize_binding(r) for r in res.scalars().all()]})


@router.post("/oidc/bindings")
async def create_oidc_binding(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
    bind_cookie: Annotated[str | None, Cookie(alias=BIND_COOKIE_NAME)] = None,
) -> Any:
    """Consume the bind cookie set by ``GET /api/admin/oidc/callback?bind=1``.

    The cookie carries the IdP-validated ``(provider, subject, email, name)``
    tuple. We refuse on missing/expired/tampered cookies and 409 on a
    pre-existing binding for the same ``(provider, subject)``.
    """
    if not bind_cookie:
        raise HTTPException(status_code=400, detail="missing_bind_cookie")
    try:
        payload = _verify_bind_cookie(bind_cookie)
    except ServiceError as exc:
        raise _service_to_http(exc) from exc

    provider = payload.get("p") or DEFAULT_PROVIDER_LABEL
    subject = payload.get("s") or ""
    if not subject:
        raise HTTPException(status_code=400, detail="invalid_bind_cookie")

    existing = await db.execute(
        select(OidcBinding).where(OidcBinding.provider == provider).where(OidcBinding.subject == subject)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="already_bound")

    row = OidcBinding(
        provider=provider,
        subject=subject,
        email=payload.get("e") or None,
        display_name=payload.get("n") or None,
    )
    db.add(row)
    await db.flush()
    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ua=_oidc_ua(request),
        extra={
            "event": "admin.oidc.binding.create",
            "provider": provider,
            "binding_id": row.id,
        },
    )
    await db.commit()
    await db.refresh(row)

    from fastapi.responses import JSONResponse

    out = JSONResponse(content=ok(_serialize_binding(row)))
    out.delete_cookie(BIND_COOKIE_NAME, path="/")
    return out


@router.delete("/oidc/bindings/{binding_id}")
async def delete_oidc_binding(
    binding_id: int,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    row = await db.get(OidcBinding, binding_id)
    if row is None:
        raise HTTPException(status_code=404, detail="binding_not_found")
    snapshot = _serialize_binding(row)
    await db.delete(row)
    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ua=_oidc_ua(request),
        extra={
            "event": "admin.oidc.binding.delete",
            "binding_id": binding_id,
            "provider": snapshot["provider"],
        },
    )
    await db.commit()
    return ok(snapshot)


# ────────────────────────────────────────────────────────────────────────────
# WebAuthn / Passkey
# ────────────────────────────────────────────────────────────────────────────


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _b64u_to_bytes(s: str) -> bytes:
    padded = s + "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def _bytes_to_b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _set_challenge_cookie(response: Response, *, name: str, payload: dict[str, Any]) -> None:
    """Attach a signed, 5-minute, HttpOnly cookie to ``response``."""
    response.set_cookie(
        key=name,
        value=sign_challenge_cookie(payload),
        max_age=CHALLENGE_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=False,  # production deployments are fronted by HTTPS termination
        path="/api/admin",
    )


def _clear_cookie(response: Response, name: str) -> None:
    response.delete_cookie(key=name, path="/api/admin")


# ── POST /api/admin/webauthn/register/begin ────────────────────────────────


@router.post("/webauthn/register/begin")
async def webauthn_register_begin(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    """Generate creation options + park the challenge in a 5-min signed cookie."""
    rp_id = await resolve_rp_id(db, request)
    rp_name = await resolve_rp_name(db)

    # Exclude already-registered credentials so the browser refuses double
    # registration of the same authenticator on the same account.
    existing = await list_credentials(db)
    exclude = [PublicKeyCredentialDescriptor(id=c.credential_id) for c in existing]

    challenge = secrets.token_bytes(32)
    options = webauthn.generate_registration_options(
        rp_id=rp_id,
        rp_name=rp_name,
        user_name=ADMIN_USER_NAME,
        user_id=ADMIN_USER_HANDLE,
        user_display_name=ADMIN_USER_NAME,
        challenge=challenge,
        exclude_credentials=exclude or None,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )

    # Park the challenge (+ rp_id) so /complete can verify against the same
    # values that were issued.
    _set_challenge_cookie(
        response,
        name=REGISTER_COOKIE_NAME,
        payload={
            "challenge": _bytes_to_b64u(challenge),
            "rp_id": rp_id,
            "exp": int(datetime.now(tz=UTC).timestamp()) + CHALLENGE_TTL_SECONDS,
        },
    )

    # ``options_to_json`` returns a JSON string; the SPA wants a dict envelope.
    import json as _json

    return ok({"options": _json.loads(webauthn.options_to_json(options))})


# ── POST /api/admin/webauthn/register/complete ─────────────────────────────


@router.post("/webauthn/register/complete")
async def webauthn_register_complete(
    request: Request,
    response: Response,
    body: WebauthnRegisterCompleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
    yd_webauthn_reg: Annotated[str | None, Cookie()] = None,
) -> dict[str, Any]:
    """Verify the attestation, then persist the credential row."""
    cookie_payload = verify_challenge_cookie(yd_webauthn_reg)
    if cookie_payload is None:
        raise HTTPException(status_code=400, detail="challenge_expired")

    challenge = _b64u_to_bytes(cookie_payload["challenge"])
    rp_id = cookie_payload["rp_id"]
    origins = await resolve_allowed_origins(db, request)

    try:
        verified = webauthn.verify_registration_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origins,
        )
    except Exception as exc:  # noqa: BLE001 — any verify error → 400
        log.warning("webauthn.register.verify_failed", error=str(exc))
        raise HTTPException(status_code=400, detail="webauthn_verification_failed") from exc

    # Reject a duplicate if the authenticator returned a credential_id we
    # already store (shouldn't happen given the exclude_credentials list, but
    # belt-and-braces).
    existing = await get_credential_by_credential_id(db, verified.credential_id)
    if existing is not None:
        raise HTTPException(status_code=409, detail="credential_already_registered")

    # Transports come over the wire as a list of strings inside the
    # ``response.transports`` field of the credential. Best-effort extraction.
    transports: list[str] = []
    try:
        raw_t = body.credential.get("response", {}).get("transports")
        if isinstance(raw_t, list):
            transports = [str(t) for t in raw_t if isinstance(t, str)]
    except Exception:
        transports = []

    row = await insert_credential(
        db,
        credential_id=verified.credential_id,
        public_key=verified.credential_public_key,
        sign_count=int(getattr(verified, "sign_count", 0) or 0),
        transports=transports,
        aaguid=getattr(verified, "aaguid", None) and None,
        label=body.label,
    )

    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=real_client_ip(request),
        ua=_ua(request),
        extra={"event": "admin.webauthn.register", "credential_pk": row.id},
    )
    await db.commit()

    _clear_cookie(response, REGISTER_COOKIE_NAME)
    return ok(credential_to_dict(row))


# ── GET /api/admin/webauthn/credentials ────────────────────────────────────


@router.get("/webauthn/credentials")
async def webauthn_list_credentials(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    rows = await list_credentials(db)
    return ok({"items": [credential_to_dict(r) for r in rows]})


# ── PATCH /api/admin/webauthn/credentials/{id} ─────────────────────────────


@router.patch("/webauthn/credentials/{cred_pk}")
async def webauthn_patch_credential(
    cred_pk: int,
    body: WebauthnCredentialPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    row = await update_credential_label(db, cred_pk, body.label)
    if row is None:
        raise HTTPException(status_code=404, detail="credential_not_found")
    return ok(credential_to_dict(row))


# ── DELETE /api/admin/webauthn/credentials/{id} ────────────────────────────


@router.delete("/webauthn/credentials/{cred_pk}")
async def webauthn_delete_credential(
    request: Request,
    cred_pk: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: Annotated[dict, Depends(require_admin)],
) -> dict[str, Any]:
    ok_ = await delete_credential(db, cred_pk)
    if not ok_:
        raise HTTPException(status_code=404, detail="credential_not_found")
    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=real_client_ip(request),
        ua=_ua(request),
        extra={"event": "admin.webauthn.delete", "credential_pk": cred_pk},
    )
    await db.commit()
    return ok({"deleted": True, "id": cred_pk})


# ── POST /api/admin/webauthn/login/begin ───────────────────────────────────


@router.post("/webauthn/login/begin")
async def webauthn_login_begin(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict[str, Any]:
    """Public — return assertion options for any registered credential."""
    rp_id = await resolve_rp_id(db, request)
    creds = await list_credentials(db)
    allow = [PublicKeyCredentialDescriptor(id=c.credential_id) for c in creds]
    challenge = secrets.token_bytes(32)
    options = webauthn.generate_authentication_options(
        rp_id=rp_id,
        challenge=challenge,
        allow_credentials=allow or None,
        user_verification=UserVerificationRequirement.PREFERRED,
    )
    _set_challenge_cookie(
        response,
        name=LOGIN_COOKIE_NAME,
        payload={
            "challenge": _bytes_to_b64u(challenge),
            "rp_id": rp_id,
            "exp": int(datetime.now(tz=UTC).timestamp()) + CHALLENGE_TTL_SECONDS,
        },
    )
    import json as _json

    return ok({"options": _json.loads(webauthn.options_to_json(options))})


# ── POST /api/admin/webauthn/login/complete ────────────────────────────────


@router.post("/webauthn/login/complete")
async def webauthn_login_complete(
    request: Request,
    response: Response,
    body: WebauthnLoginCompleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    yd_webauthn_auth: Annotated[str | None, Cookie()] = None,
) -> dict[str, Any]:
    """Public — verify assertion and mint an admin JWT."""
    cookie_payload = verify_challenge_cookie(yd_webauthn_auth)
    if cookie_payload is None:
        raise HTTPException(status_code=400, detail="challenge_expired")

    challenge = _b64u_to_bytes(cookie_payload["challenge"])
    rp_id = cookie_payload["rp_id"]
    origins = await resolve_allowed_origins(db, request)

    # Look up the stored credential by the raw id the client returned.
    raw_id = body.credential.get("rawId") or body.credential.get("id")
    if not isinstance(raw_id, str):
        raise HTTPException(status_code=400, detail="missing_credential_id")
    try:
        credential_id_bytes = _b64u_to_bytes(raw_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="bad_credential_id") from exc

    stored = await get_credential_by_credential_id(db, credential_id_bytes)
    if stored is None:
        raise HTTPException(status_code=404, detail="credential_not_found")

    try:
        verified = webauthn.verify_authentication_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origins,
            credential_public_key=stored.public_key,
            credential_current_sign_count=stored.sign_count,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("webauthn.login.verify_failed", error=str(exc))
        raise HTTPException(status_code=401, detail="webauthn_verification_failed") from exc

    new_count = int(getattr(verified, "new_sign_count", 0) or 0)
    # Cloned-authenticator guard: stored.sign_count > 0 and the response
    # counter is not strictly greater → reject. Some platform authenticators
    # always send 0; accept that sentinel.
    if stored.sign_count > 0 and new_count <= stored.sign_count:
        raise HTTPException(status_code=401, detail="signature_counter_replay")

    await bump_credential_usage(db, stored.id, new_sign_count=new_count)

    token, expires_at = issue_admin_token()
    await record_access(
        db,
        action=AccessLogAction.ADMIN_ACTION,
        ip=real_client_ip(request),
        ua=_ua(request),
        extra={"event": "admin.webauthn.login", "credential_pk": stored.id},
    )
    await db.commit()

    _clear_cookie(response, LOGIN_COOKIE_NAME)
    return ok(
        {
            "token": token,
            "token_type": "Bearer",
            "expires_at": expires_at.isoformat(),
        }
    )
