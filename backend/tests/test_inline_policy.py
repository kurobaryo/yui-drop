"""Serve-time content-type policy for uploaded files.

Every share payload is streamed back from the SPA's own origin, so the
``Content-Type`` / ``Content-Disposition`` pair decides whether an upload stays
inert data. These tests pin the contract implemented in
``app/services/inline_policy.py``:

* the served type is derived from the stored file name only — never from the
  uploader-declared type that S3-compatible storage echoes back on HEAD;
* only raster images, audio, video, PDF and text previews are ever inline, and
  text previews are always ``text/plain; charset=utf-8``;
* everything else is an ``application/octet-stream`` attachment;
* every file response carries nosniff + a sandboxed CSP (PDF: no ``sandbox``)
  + CORP + X-Frame-Options, and the global middleware does not replace them;
* ``/api/share/select`` reports the same type the proxy serves.
"""
from __future__ import annotations

import io
import uuid
from typing import Any

import pytest

from app.services.inline_policy import (
    OCTET_STREAM,
    PDF_CSP,
    SANDBOX_CSP,
    TEXT_PLAIN,
    file_response_headers,
    served_type,
)

# ── Pure helper ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "name",
    [
        "a.html", "a.htm", "a.HTML", "a.xhtml", "a.xht", "a.svg", "a.svgz",
        "a.xml", "a.xsl", "a.xslt", "a.rdf", "a.js", "a.mjs", "a.cjs", "a.css",
        "a.mht", "a.mhtml", "a.eml", "a.swf", "a.zip", "a.exe", "a.docx",
        "a.ics", "a.unknownext", "noextension", "a.txt.html", "a.png.svg",
        "", None,
    ],
)
def test_non_allowlisted_names_are_opaque_attachments(name: str | None) -> None:
    assert served_type(name) == (OCTET_STREAM, False)


@pytest.mark.parametrize(
    ("name", "media"),
    [
        ("a.png", "image/png"),
        ("a.jpg", "image/jpeg"),
        ("a.JPEG", "image/jpeg"),
        ("a.webp", "image/webp"),
        ("a.avif", "image/avif"),
        ("a.gif", "image/gif"),
        ("a.heic", "image/heic"),
        ("a.mp4", "video/mp4"),
        ("a.webm", "video/webm"),
        ("a.mov", "video/quicktime"),
        ("a.mkv", "video/x-matroska"),
        ("a.mp3", "audio/mpeg"),
        ("a.m4a", "audio/mp4"),
        ("a.wav", "audio/wav"),
        ("a.flac", "audio/flac"),
        ("a.ogg", "audio/ogg"),
        ("a.pdf", "application/pdf"),
    ],
)
def test_media_is_inline_with_its_real_type(name: str, media: str) -> None:
    assert served_type(name) == (media, True)


@pytest.mark.parametrize(
    "name",
    ["a.md", "a.txt", "a.csv", "a.json", "a.py", "a.yaml", "a.yml", "a.log",
     "a.ts", "a.sh", "a.toml", "a.html.txt", "报告.md"],
)
def test_text_is_inline_as_plain_utf8(name: str) -> None:
    assert served_type(name) == (TEXT_PLAIN, True)


def test_suffix_is_used_when_name_is_missing() -> None:
    assert served_type(None, ".png") == ("image/png", True)
    assert served_type(None, ".html") == (OCTET_STREAM, False)


def test_pdf_csp_drops_sandbox_but_keeps_default_none() -> None:
    assert "sandbox" not in PDF_CSP
    assert PDF_CSP.startswith("default-src 'none'")
    assert file_response_headers("application/pdf", inline=True)["content-security-policy"] == PDF_CSP
    # A PDF forced to download gets the sandboxed policy like everything else.
    assert file_response_headers(OCTET_STREAM, inline=False)["content-security-policy"] == SANDBOX_CSP


# ── Route helpers ───────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    from app.core.rate_limit import limiter

    limiter.reset()
    yield


@pytest.fixture
def storage_declares_html(monkeypatch):
    """Make the storage HEAD report ``text/html`` for every object.

    This is what an S3-compatible backend returns when the uploader declared
    that type at multipart init; the local backend reports ``None``.
    """
    from app.services import share as share_svc

    original = share_svc.open_download_stream

    async def _fake(key: str, wrapped_dek: bytes | None = None):
        body, head = await original(key, wrapped_dek=wrapped_dek)
        return body, {**head, "content_type": "text/html"}

    monkeypatch.setattr(share_svc, "open_download_stream", _fake)
    import app.api.share as share_api

    monkeypatch.setattr(share_api, "open_download_stream", _fake)


async def _upload(client, filename: str, body: bytes = b"<script>1</script>\n") -> str:
    res = await client.post(
        "/api/share/file",
        files={"file": (filename, body, "text/html")},
        data={"expire_value": "1", "expire_style": "hour"},
    )
    assert res.status_code == 200, res.text
    return res.json()["detail"]["code"]


async def _select(client, code: str) -> dict[str, Any]:
    res = await client.post("/api/share/select", json={"code": code})
    assert res.status_code == 200, res.text
    return res.json()["detail"]


def _assert_hardened(res, *, csp: str = SANDBOX_CSP) -> None:
    h = res.headers
    assert h["x-content-type-options"] == "nosniff"
    assert h["cross-origin-resource-policy"] == "same-origin"
    assert h["x-frame-options"] == "SAMEORIGIN"
    # Exactly one CSP, and it is ours rather than the SPA's page policy.
    assert h.get_list("content-security-policy") == [csp]


async def _multi_share(client, files: list[tuple[str, bytes, str]]) -> str:
    """Multi-share lifecycle with an uploader-declared content type per file."""
    init = await client.post(
        "/api/share/multi/init",
        json={
            "declared_file_count": len(files),
            "declared_total_size": sum(len(b) for _, b, _ in files),
            "expire_value": 1,
            "expire_style": "hour",
        },
    )
    assert init.status_code == 200, init.text
    share_id = init.json()["detail"]["share_id"]
    headers = {"Authorization": f"Bearer {init.json()['detail']['upload_token']}"}
    for name, payload, declared in files:
        f = await client.post(
            f"/api/share/multi/{share_id}/file/init",
            headers=headers,
            json={
                "name": name,
                "size": len(payload),
                "content_type": declared,
                "declared_chunked": True,
                "chunk_size": 1024 * 1024,
            },
        )
        assert f.status_code == 200, f.text
        fd = f.json()["detail"]
        part = await client.post(
            f"/api/chunk/upload/{fd['upload_id']}/0",
            files={"chunk": ("blob", payload, "application/octet-stream")},
        )
        assert part.status_code == 200, part.text
        done = await client.post(
            f"/api/share/multi/{share_id}/file/{fd['file_id']}/complete",
            headers=headers,
            json={"total_uploaded_bytes": len(payload)},
        )
        assert done.status_code == 200, done.text
    fin = await client.post(f"/api/share/multi/{share_id}/finalize", headers=headers)
    assert fin.status_code == 200, fin.text
    return fin.json()["detail"]["code"]


# ── Single-file proxy ───────────────────────────────────────────────────────


async def test_declared_html_type_is_ignored_for_txt(client, storage_declares_html) -> None:
    code = await _upload(client, "probe.txt")
    res = await client.get(f"/api/share/download/{code}")
    assert res.status_code == 200
    assert res.headers["content-type"] == TEXT_PLAIN
    assert res.headers["content-disposition"].startswith("inline;")
    _assert_hardened(res)


async def test_html_upload_is_an_opaque_attachment(client, storage_declares_html) -> None:
    code = await _upload(client, "evil.html")
    res = await client.get(f"/api/share/download/{code}")
    assert res.status_code == 200
    assert res.headers["content-type"] == OCTET_STREAM
    assert res.headers["content-disposition"].startswith("attachment;")
    _assert_hardened(res)


@pytest.mark.parametrize("name", ["evil.svg", "evil.xml", "evil.js", "evil.mht", "noext"])
async def test_other_active_types_are_attachments(client, name: str) -> None:
    code = await _upload(client, name)
    res = await client.get(f"/api/share/download/{code}")
    assert res.headers["content-type"] == OCTET_STREAM
    assert res.headers["content-disposition"].startswith("attachment;")
    _assert_hardened(res)


async def test_dl_flag_forces_attachment_and_keeps_hardening(client) -> None:
    code = await _upload(client, "photo.png", b"\x89PNG\r\n\x1a\n")
    res = await client.get(f"/api/share/download/{code}?dl=1")
    assert res.headers["content-type"] == OCTET_STREAM
    assert res.headers["content-disposition"].startswith("attachment;")
    _assert_hardened(res)


async def test_image_is_inline_with_real_type(client, storage_declares_html) -> None:
    code = await _upload(client, "photo.png", b"\x89PNG\r\n\x1a\n")
    res = await client.get(f"/api/share/download/{code}")
    assert res.headers["content-type"] == "image/png"
    assert res.headers["content-disposition"].startswith("inline;")
    _assert_hardened(res)


async def test_pdf_is_inline_without_sandbox(client) -> None:
    code = await _upload(client, "doc.pdf", b"%PDF-1.4\n")
    res = await client.get(f"/api/share/download/{code}")
    assert res.headers["content-type"] == "application/pdf"
    assert res.headers["content-disposition"].startswith("inline;")
    _assert_hardened(res, csp=PDF_CSP)


@pytest.mark.parametrize(
    ("name", "ct", "force"),
    [
        ("probe.txt", TEXT_PLAIN, False),
        ("notes.md", TEXT_PLAIN, False),
        ("photo.webp", "image/webp", False),
        ("doc.pdf", "application/pdf", False),
        ("evil.html", OCTET_STREAM, True),
        ("evil.svg", OCTET_STREAM, True),
        ("archive.zip", OCTET_STREAM, True),
    ],
)
async def test_select_reports_what_the_proxy_serves(
    client, name: str, ct: str, force: bool
) -> None:
    code = await _upload(client, name)
    detail = await _select(client, code)
    assert (detail["content_type"], detail["force_download"]) == (ct, force)
    res = await client.get(detail["url"])
    assert res.headers["content-type"] == ct


# ── Multi-file proxy ────────────────────────────────────────────────────────


async def test_multi_share_files_follow_the_same_policy(client, storage_declares_html) -> None:
    code = await _multi_share(
        client,
        [
            ("probe.txt", b"<script>1</script>", "text/html"),
            ("evil.svg", b"<svg/>", "image/svg+xml"),
            ("cat.jpg", b"\xff\xd8\xff", "text/html"),
        ],
    )
    detail = await _select(client, code)
    by_name = {f["name"]: f for f in detail["files"]}
    assert (by_name["probe.txt"]["content_type"], by_name["probe.txt"]["force_download"]) == (TEXT_PLAIN, False)
    assert (by_name["evil.svg"]["content_type"], by_name["evil.svg"]["force_download"]) == (OCTET_STREAM, True)
    assert (by_name["cat.jpg"]["content_type"], by_name["cat.jpg"]["force_download"]) == ("image/jpeg", False)

    txt = await client.get(by_name["probe.txt"]["url"])
    assert txt.headers["content-type"] == TEXT_PLAIN
    assert txt.headers["content-disposition"].startswith("inline;")
    _assert_hardened(txt)

    svg = await client.get(by_name["evil.svg"]["url"])
    assert svg.headers["content-type"] == OCTET_STREAM
    assert svg.headers["content-disposition"].startswith("attachment;")
    _assert_hardened(svg)

    jpg = await client.get(f"{by_name['cat.jpg']['url']}&dl=1")
    assert jpg.headers["content-type"] == OCTET_STREAM
    assert jpg.headers["content-disposition"].startswith("attachment;")
    _assert_hardened(jpg)


# ── Other file routes ───────────────────────────────────────────────────────


async def _put_object(data: bytes) -> str:
    from app.storage import get_storage

    key = f"test/{uuid.uuid4().hex}/blob"
    await get_storage().server_write(key, io.BytesIO(data), len(data))
    return key


async def test_collection_blob_is_hardened_attachment(client, storage_declares_html) -> None:
    from app.core.security import encode_jwt

    key = await _put_object(b"<script>1</script>")
    token = encode_jwt({"k": key, "fn": "evil.html", "fid": 1, "cid": 1})
    res = await client.get(f"/api/collections/room/files/1/blob?token={token}")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == OCTET_STREAM
    assert res.headers["content-disposition"].startswith("attachment;")
    _assert_hardened(res)


async def test_legacy_token_download_is_hardened_attachment(client) -> None:
    from app.core.security import encode_jwt

    key = await _put_object(b"<script>1</script>")
    token = encode_jwt({"key": key, "fn": "evil.html"})
    res = await client.get(f"/api/share/download?token={token}")
    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == OCTET_STREAM
    assert res.headers["content-disposition"].startswith("attachment;")
    _assert_hardened(res)


async def test_non_file_responses_keep_the_page_csp(client) -> None:
    """The file policy must not leak onto ordinary API responses."""
    res = await client.get("/api/health")
    assert "sandbox" not in res.headers["content-security-policy"]
