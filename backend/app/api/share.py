"""Share endpoints: text + simple file + select + download."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import settings
from ..core.download_token import verify_download_token
from ..core.rate_limit import limiter, real_client_ip, retrieve_fail_tracker, upload_limit
from ..db.session import get_db
from ..models.access_log import AccessLogAction
from ..schemas import ok
from ..schemas.share import (
    ShareSelectRequest,
    ShareTextRequest,
)
from ..services.admin_turnstile import resolve_turnstile_config
from ..services.common import ForbiddenError, NotFoundError, ServiceError, record_access
from ..services.inline_policy import OCTET_STREAM, file_response_headers
from ..services.share import (
    DownloadNotFound,
    authorize_download_token,
    create_simple_file_share,
    create_text_share,
    open_download_stream,
    parse_download_file_id,
    record_retrieve_miss,
    resolve_download_target,
    resolve_share,
)
from ..services.turnstile import verify_turnstile

router = APIRouter(prefix="/api/share", tags=["share"])


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _service_to_http(exc: ServiceError) -> HTTPException:
    """Translate a ServiceError into an HTTPException with our envelope shape."""
    return HTTPException(
        status_code=exc.http_status,
        detail={"code": exc.code, "message": exc.message, "detail": exc.detail},
    )


_TURNSTILE_FAIL_CODE = 4003  # API envelope code for "turnstile_failed"


async def _turnstile_gate(
    request: Request,
    db: AsyncSession,
    token: str | None,
    *,
    flag: str,
) -> JSONResponse | None:
    """Return a 4003 JSONResponse if turnstile is on for ``flag`` and verify fails.

    ``flag`` is the config key inside :func:`resolve_turnstile_config` —
    ``protect_upload`` or ``protect_pickup``. When turnstile is disabled
    globally OR the per-action flag is off OR no secret is configured,
    we return ``None`` so the caller proceeds straight through. This is the
    safety net spec'd as Q4: a misconfigured deployment must not lock users
    out of a feature that was previously open.
    """
    cfg = await resolve_turnstile_config(db)
    if not cfg.get("enabled"):
        return None
    if not cfg.get(flag):
        return None
    if not cfg.get("secret_key"):
        # Enabled but no secret reachable — verify_turnstile would skip
        # anyway. Stay in skip mode rather than hard-failing the route.
        return None
    ok_ = await verify_turnstile(token or "", remote_ip=real_client_ip(request), db=db)
    if not ok_:
        return JSONResponse(
            status_code=400,
            content={"code": 4003, "message": "turnstile_failed"},
        )
    return None


# ────────────────────────────────────────────────────────────────────────────
# POST /api/share/text
# ────────────────────────────────────────────────────────────────────────────


@router.post("/text")
@limiter.limit(upload_limit())
async def share_text(
    request: Request,
    response: Response,
    body: ShareTextRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    """Create a text share. Rate-limited per IP."""
    gate = await _turnstile_gate(request, db, body.turnstile_token, flag="protect_upload")
    if gate is not None:
        return gate
    ip = real_client_ip(request)
    try:
        out = await create_text_share(
            db,
            text=body.text,
            expire_value=body.expire_value,
            expire_style=body.expire_style,
            ip=ip,
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# POST /api/share/file  (multipart/form-data, ≤ 10 MiB)
# ────────────────────────────────────────────────────────────────────────────


@router.post("/file")
@limiter.limit(upload_limit())
async def share_file(
    request: Request,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
    file: Annotated[UploadFile, File(...)],
    expire_value: Annotated[int, Form()] = 1,
    expire_style: Annotated[str, Form()] = "day",
    turnstile_token: Annotated[str | None, Form()] = None,
) -> Any:
    gate = await _turnstile_gate(request, db, turnstile_token, flag="protect_upload")
    if gate is not None:
        return gate
    ip = real_client_ip(request)
    size = 0
    # Drain the SpooledTemporaryFile so we know the actual size.
    pos = file.file.tell()
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(pos)
    try:
        out = await create_simple_file_share(
            db,
            file_name=file.filename or "file",
            file_obj=file.file,
            file_size=size,
            content_type=file.content_type,
            expire_value=expire_value,
            expire_style=expire_style,
            ip=ip,
            ua=_ua(request),
        )
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# POST /api/share/select
# ────────────────────────────────────────────────────────────────────────────


@router.post("/select")
async def share_select(
    request: Request,
    body: ShareSelectRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Any:
    gate = await _turnstile_gate(request, db, body.turnstile_token, flag="protect_pickup")
    if gate is not None:
        return gate
    ip = real_client_ip(request)
    try:
        out = await resolve_share(db, code=body.code, ip=ip, ua=_ua(request))
    except ServiceError as e:
        raise _service_to_http(e) from e
    return ok(out)


# ────────────────────────────────────────────────────────────────────────────
# GET /api/share/download  (local-backend token-protected proxy)
# ────────────────────────────────────────────────────────────────────────────


@router.get("/download")
async def share_download(
    request: Request,
    token: Annotated[str, Query(...)],
    filename: Annotated[str | None, Query()] = None,
) -> StreamingResponse:
    """Stream an object referenced by a short-lived signed token.

    Only used when the storage backend cannot mint native presigned URLs
    (local FS today; OneDrive/WebDAV when implemented).
    """
    try:
        key, fn_from_token = await authorize_download_token(token)
        body, head = await open_download_stream(key)
    except ServiceError as e:
        raise _service_to_http(e) from e

    display_name = filename or fn_from_token or key.rsplit("/", 1)[-1]
    headers: dict[str, str] = {}
    if head.get("size") is not None:
        headers["content-length"] = str(head["size"])
    # Always attachment for the local-backed download path — keeps inert in browsers.
    from urllib.parse import quote as _q

    # ASCII fallback for the legacy `filename=` parameter (HTTP/1.1 headers
    # are latin-1, so CJK there crashes starlette). Real UTF-8 name lives in
    # the RFC 5987 `filename*` parameter.
    _ascii = display_name.encode("ascii", "replace").decode("ascii").replace("?", "_")
    if not _ascii.strip("_") or _ascii != display_name:
        _ascii = "download"
    _ascii = _ascii.replace('"', "").replace("\\", "").replace("\r", "").replace("\n", "")
    headers["content-disposition"] = (
        f'attachment; filename="{_ascii}"; filename*=UTF-8\'\'{_q(display_name)}'
    )
    headers.update(file_response_headers(OCTET_STREAM, inline=False))
    return StreamingResponse(body, media_type=OCTET_STREAM, headers=headers)


# ────────────────────────────────────────────────────────────────────────────
# GET /api/share/download/{code}            — single-file share proxy
# GET /api/share/download/{code}/{file_id}  — multi-file share, one file
# ────────────────────────────────────────────────────────────────────────────


def _download_rate_key(request: Request) -> str:
    """slowapi key: client IP, in a separate bucket when the URL is signed.

    The token is verified statelessly (HMAC only, no DB) — enough to keep
    unsigned probes out of the larger signed-download allowance.
    """
    ip = real_client_ip(request)
    token = request.query_params.get("t")
    if token:
        try:
            file_id = parse_download_file_id(request.path_params.get("file_id"))
        except ServiceError:
            return ip
        code = request.path_params.get("code", "")
        if verify_download_token(token, code=code, file_id=file_id) is not None:
            return f"signed:{ip}"
    return ip


def _download_limit(key: str) -> str:
    """Per-IP limit for the download routes (see ``_download_rate_key``)."""
    if key.startswith("signed:"):
        return f"{settings.rate_limit_download_signed_per_min}/minute"
    return f"{settings.rate_limit_download_per_min}/minute"


async def _stream_share_payload(
    request: Request,
    db: AsyncSession,
    code: str,
    file_id: str | None,
    *,
    token: str | None = None,
    force_attachment: bool = False,
) -> StreamingResponse:
    """Shared body for the two same-origin download routes.

    Resolves the share, opens a server-side stream from the storage
    backend (boto3 ``get_object`` body for S3, async file iterator for
    local FS), and writes an access_logs row. The audit toggle is
    honoured inside :func:`record_access`, so callers don't need to
    re-check it here.

    Every refusal is the same 404 ``code_not_found`` and counts as a failed
    retrieve for the client IP — the same tracker, threshold and ban as
    pickup. A banned IP gets the same 403 pickup gives it.

    ``force_attachment`` comes from the ``?dl=1`` query parameter. The
    default (inline) response is what makes ``<img>`` / ``<video>`` /
    ``<iframe>`` previews work, so we can't unconditionally send
    ``attachment`` — but a plain inline link is exactly why "Download"
    used to open a viewer tab instead of saving the file. Splitting the
    two behaviours onto the same URL lets the preview and the download
    button coexist.
    """
    ip = real_client_ip(request)
    if ip and await retrieve_fail_tracker.is_banned(ip):
        raise _service_to_http(
            ForbiddenError("ip_banned", detail={"reason": "too_many_failures"})
        )
    try:
        fid = parse_download_file_id(file_id)
        target = await resolve_download_target(db, code=code, file_id=fid, token=token)
        body, head = await open_download_stream(
            target["key"], wrapped_dek=target.get("wrapped_dek")
        )
    except NotFoundError as e:
        reason = e.reason if isinstance(e, DownloadNotFound) else e.message
        await record_retrieve_miss(
            db,
            code=code,
            ip=ip,
            ua=_ua(request),
            tracked=ip,
            reason=reason,
            event="share.download.miss",
        )
        raise _service_to_http(DownloadNotFound(reason)) from e
    except ServiceError as e:
        raise _service_to_http(e) from e

    # The served type comes from the stored file name only (see
    # services/inline_policy.py) — never from the storage HEAD answer, which
    # on S3 is whatever the uploader declared. resolve_download_target has
    # already applied the inline allowlist; anything outside it arrives
    # with force_download set.
    force_dl: bool = bool(target["force_download"])
    # ``?dl=1`` is a client-side intent ("save this"), independent of the
    # security-driven allowlist. Either one is enough to switch us to
    # attachment.
    as_attachment: bool = force_dl or force_attachment
    display_name: str = target["name"] or code
    media_type: str = OCTET_STREAM if as_attachment else target["content_type"]

    from urllib.parse import quote as _q

    # ASCII-only fallback for the legacy `filename=` parameter (HTTP/1.1
    # headers are latin-1 by spec, so CJK/emoji here crash starlette with
    # UnicodeEncodeError). Modern clients pick `filename*` (RFC 5987) which
    # carries the real UTF-8 name; keep an ASCII placeholder for the rest.
    ascii_name = display_name.encode("ascii", "replace").decode("ascii").replace("?", "_")
    if not ascii_name.strip("_") or ascii_name != display_name:
        ascii_name = f"download-{code}"
    # Strip characters that would break the quoted-string form.
    ascii_name = ascii_name.replace('"', "").replace("\\", "").replace("\r", "").replace("\n", "")

    disposition = "attachment" if as_attachment else "inline"
    headers: dict[str, str] = {
        "content-disposition": (
            f'{disposition}; filename="{ascii_name}"; '
            f"filename*=UTF-8''{_q(display_name)}"
        ),
        # Same-origin proxy bytes are inherently cacheable per-code; let
        # the browser hold onto them briefly so repeat <img> renders
        # don't hammer R2. Short TTL keeps the cache from outliving a
        # code's expiry by much.
        #
        # ``Vary: accept`` is not enough here — the inline and attachment
        # responses live on the same URL and differ only by the ``dl``
        # query parameter, which is already part of the cache key.
        "cache-control": "private, max-age=60",
        # nosniff + sandboxed CSP + CORP/XFO. These are set explicitly so the
        # global SecurityHeadersMiddleware (setdefault) leaves them alone.
        **file_response_headers(media_type, inline=not as_attachment),
    }
    if head.get("size") is not None:
        headers["content-length"] = str(head["size"])

    # Append the audit row. record_access honours the audit.log_access_ip
    # toggle (default on) — when off, the IP is dropped before insert.
    await record_access(
        db,
        action=AccessLogAction.SHARE_RETRIEVE,
        code=code,
        ip=ip,
        ua=_ua(request),
        status_code=200,
        extra={
            "event": "share.download.proxy",
            "file_id": fid,
            "size": head.get("size"),
            "force_download": as_attachment,
            "disposition": disposition,
        },
    )
    await db.commit()

    return StreamingResponse(body, media_type=media_type, headers=headers)


@router.get("/download/{code}")
@limiter.limit(_download_limit, key_func=_download_rate_key)
async def share_download_by_code(
    request: Request,
    code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    dl: Annotated[int, Query(ge=0, le=1)] = 0,
    t: Annotated[str | None, Query(max_length=128)] = None,
) -> StreamingResponse:
    """Same-origin proxy for single-file shares.

    Streams the underlying object through this process so the browser
    never sees an R2 presigned URL. Restores ``<img>`` previews that
    were blocked by cross-origin CORS and centralises access logging.

    ``?t=`` is the signed token from a pickup / owner listing (see
    :func:`resolve_download_target` for when it is required).

    ``?dl=1`` switches the response to ``Content-Disposition: attachment``
    so the browser saves the file instead of rendering it in a tab.
    Without it the bytes are served inline, which is what the preview
    surfaces (``<img>``, ``<video>``, ``<iframe>``) need.
    """
    return await _stream_share_payload(
        request, db, code, None, token=t, force_attachment=bool(dl)
    )


@router.get("/download/{code}/{file_id}")
@limiter.limit(_download_limit, key_func=_download_rate_key)
async def share_download_multi_by_code(
    request: Request,
    code: str,
    file_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    dl: Annotated[int, Query(ge=0, le=1)] = 0,
    t: Annotated[str | None, Query(max_length=128)] = None,
) -> StreamingResponse:
    """Same-origin proxy for one file inside a multi-file share.

    ``file_id`` is taken as a string so a malformed id gets the same 404 as
    every other refusal instead of a distinguishable 422. ``?t=`` and
    ``?dl=1`` work as in :func:`share_download_by_code`.
    """
    return await _stream_share_payload(
        request, db, code, file_id, token=t, force_attachment=bool(dl)
    )
