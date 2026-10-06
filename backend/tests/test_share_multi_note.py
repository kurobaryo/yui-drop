"""Optional note on multi-file shares.

A multi share may carry a short text note (``ShareMultiInitRequest.text``)
stored on the parent ``filecodes`` row. That row also has ``file_path`` NULL,
which is exactly what several readers used to treat as "this is a text
share". These tests pin both halves of the contract:

* the note round-trips through init → pickup (SPA and /api/v1), and
* a multi share with a note is never reported as a text share (admin list,
  admin detail, admin text preview, v1 listing projection).
"""
from __future__ import annotations

from typing import Any

import pytest

from tests._api_helpers import admin_headers, admin_login, issue_key, key_headers


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """Each multi init counts against the per-IP upload limit; start clean."""
    from app.core.rate_limit import limiter

    limiter.reset()
    yield


def _envelope(res) -> dict[str, Any]:
    body = res.json().get("detail") or {}
    return body if isinstance(body, dict) else {}


async def _multi_share(
    client,
    *,
    text: str | None = None,
    files: list[tuple[str, bytes]] | None = None,
) -> str:
    """Run the full multi-share lifecycle and return the pickup code."""
    files = files or [("a.txt", b"hello multi\n")]
    body: dict[str, Any] = {
        "declared_file_count": len(files),
        "declared_total_size": sum(len(b) for _, b in files),
        "expire_value": 1,
        "expire_style": "hour",
    }
    if text is not None:
        body["text"] = text
    init = await client.post("/api/share/multi/init", json=body)
    assert init.status_code == 200, init.text
    share_id = init.json()["detail"]["share_id"]
    headers = {"Authorization": f"Bearer {init.json()['detail']['upload_token']}"}

    for name, payload in files:
        f = await client.post(
            f"/api/share/multi/{share_id}/file/init",
            headers=headers,
            json={
                "name": name,
                "size": len(payload),
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


async def _select(client, code: str) -> dict[str, Any]:
    res = await client.post("/api/share/select", json={"code": code})
    assert res.status_code == 200, res.text
    return res.json()["detail"]


# ── Round trip ──────────────────────────────────────────────────────────────


async def test_note_round_trips_through_pickup(client):
    note = "Meet at 10 in the lobby.\n明天见 ✓"
    code = await _multi_share(client, text=note)

    got = await _select(client, code)
    assert got["kind"] == "multi"
    assert got["text"] == note
    assert got["file_count"] == 1
    assert [f["name"] for f in got["files"]] == ["a.txt"]


async def test_single_file_with_note_is_still_multi(client):
    """The composer sends text + one file through the multi path."""
    code = await _multi_share(client, text="see attached", files=[("one.pdf", b"%PDF-1.4\n")])
    got = await _select(client, code)
    assert got["kind"] == "multi"
    assert got["text"] == "see attached"
    path = got["files"][0]["url"].partition("?")[0]
    assert path.endswith(f"/api/share/download/{code}/{got['files'][0]['file_id']}")


async def test_multi_without_note_has_null_text(client):
    code = await _multi_share(client)
    got = await _select(client, code)
    assert got["kind"] == "multi"
    assert got["text"] is None


async def test_blank_note_is_stored_as_null(client):
    code = await _multi_share(client, text="   \n ")
    got = await _select(client, code)
    assert got["kind"] == "multi"
    assert got["text"] is None


async def test_note_is_returned_by_v1_pickup(client):
    plaintext, _record, _token = await issue_key(client, scopes=["read"])
    code = await _multi_share(client, text="via api")

    res = await client.post(
        "/api/v1/pickup", headers=key_headers(plaintext), json={"code": code}
    )
    assert res.status_code == 200, res.text
    detail = res.json()["detail"]
    assert detail["kind"] == "multi"
    assert detail["text"] == "via api"
    assert detail["files"][0]["url"].startswith("http")


# ── Limits ──────────────────────────────────────────────────────────────────


async def test_oversize_note_rejected_like_text_share(client):
    from app.core.config import settings

    too_big = "x" * (settings.max_text_bytes + 1)
    res = await client.post(
        "/api/share/multi/init",
        json={
            "declared_file_count": 1,
            "declared_total_size": 10,
            "expire_value": 1,
            "expire_style": "hour",
            "text": too_big,
        },
    )
    assert res.status_code == 413, res.text
    env = _envelope(res)
    assert env.get("code") == 4131
    assert env.get("message") == "text_too_large"


async def test_note_limit_counts_utf8_bytes(client):
    """Same byte-based cap as text shares: 3-byte CJK chars hit it sooner."""
    from app.core.config import settings

    # Fits by character count, exceeds by byte count.
    note = "字" * (settings.max_text_bytes // 3 + 1)
    assert len(note) <= settings.max_text_bytes
    res = await client.post(
        "/api/share/multi/init",
        json={"declared_file_count": 1, "declared_total_size": 1, "text": note},
    )
    assert res.status_code == 413, res.text


# ── Never reported as a text share ──────────────────────────────────────────


async def test_admin_does_not_report_multi_note_as_text(client):
    code = await _multi_share(client, text="not a text share")
    token = await admin_login(client)
    h = admin_headers(token)

    listing = await client.get("/api/admin/file", headers=h, params={"size": 50})
    assert listing.status_code == 200, listing.text
    rows = [r for r in listing.json()["detail"]["items"] if r["code"] == code]
    assert len(rows) == 1
    assert rows[0]["is_text"] is False

    one = await client.get(f"/api/admin/files/{code}", headers=h)
    assert one.status_code == 200, one.text
    assert one.json()["detail"]["is_text"] is False

    # The text-preview endpoint is for pure text shares only.
    content = await client.get(f"/api/admin/files/{code}/content", headers=h)
    assert content.status_code == 404, content.text


async def test_admin_still_reports_plain_text_share_as_text(client):
    res = await client.post(
        "/api/share/text",
        json={"text": "plain", "expire_value": 1, "expire_style": "hour"},
    )
    assert res.status_code == 200, res.text
    code = res.json()["detail"]["code"]

    token = await admin_login(client)
    one = await client.get(f"/api/admin/files/{code}", headers=admin_headers(token))
    assert one.json()["detail"]["is_text"] is True


def test_v1_list_projection_keeps_download_url_for_multi_with_note():
    from app.api.v1 import _row_to_list_item
    from app.models.file_code import FileCode

    row = FileCode(
        code="123456", kind="multi", text="note", file_path=None,
        expired_count=-1, used_count=0,
    )
    item = _row_to_list_item(row)
    assert item["kind"] == "multi"
    assert item["url"] is not None


@pytest.mark.parametrize(
    ("kind", "text", "file_path", "expected"),
    [
        ("text", "hi", None, True),
        # Legacy text rows predate kind='text' and still say 'file'.
        ("file", "hi", None, True),
        ("file", None, "k/a.bin", False),
        ("multi", None, None, False),
        ("multi", "note", None, False),
    ],
)
def test_is_text_share(kind, text, file_path, expected):
    from app.models.file_code import FileCode

    row = FileCode(code="000000", kind=kind, text=text, file_path=file_path)
    assert row.is_text_share is expected
