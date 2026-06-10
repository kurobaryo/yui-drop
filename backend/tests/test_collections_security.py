"""Security regression tests for Collection upload and runtime hardening.

These tests intentionally cover issues found in the 2026-06-09 audit:
- collection uploads must obey the room upload toggle;
- pending files must not be visible/downloadable;
- local multipart paths must reject traversal-shaped upload ids;
- local collection uploads must complete successfully;
- upload sessions are bound to the member/file that created them.
"""
from __future__ import annotations


def _detail(res):
    body = res.json()
    return body.get("detail") if isinstance(body, dict) else None


async def _create_collection(client, *, visibility: str = "public") -> tuple[str, str, int]:
    res = await client.post(
        "/api/collections",
        json={
            "name": "audit-room",
            "visibility": visibility,
            "entry_password": None,
            "admin_password": "owner-pass",
            "lifetime_days": 1,
        },
    )
    assert res.status_code == 200, res.text
    d = res.json()["detail"]
    return d["code"], d["member_token"], d["member_id"]


async def _join_collection(client, code: str, nickname: str = "guest") -> tuple[str, int]:
    res = await client.post(
        f"/api/collections/{code}/join",
        json={"nickname": nickname, "entry_password": None},
    )
    assert res.status_code == 200, res.text
    d = res.json()["detail"]
    return d["member_token"], d["member_id"]


async def _init_file(client, code: str, member_token: str, *, name: str = "x.txt", size: int = 3):
    return await client.post(
        f"/api/collections/{code}/files/init",
        headers={"X-Member-Token": member_token},
        json={
            "name": name,
            "size": size,
            "content_type": "text/plain",
            "chunk_size": 10,
        },
    )


async def test_collection_upload_disabled_blocks_file_init(client):
    code, member_token, _member_id = await _create_collection(client)

    toggle = await client.post(
        f"/api/collections/{code}/admin/upload-toggle",
        headers={"X-Admin-Password": "owner-pass"},
        json={"enabled": False},
    )
    assert toggle.status_code == 200, toggle.text

    res = await _init_file(client, code, member_token)

    assert res.status_code == 403, res.text
    assert _detail(res)["message"] == "upload_disabled"


async def test_collection_pending_file_is_hidden_from_list_and_download(client):
    code, member_token, _member_id = await _create_collection(client)

    init = await _init_file(client, code, member_token)
    assert init.status_code == 200, init.text
    file_id = init.json()["detail"]["file_id"]

    listed = await client.get(
        f"/api/collections/{code}/files",
        headers={"X-Member-Token": member_token},
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["detail"]["files"] == []

    download = await client.get(
        f"/api/collections/{code}/files/{file_id}/download",
        headers={"X-Member-Token": member_token},
    )
    assert download.status_code == 404, download.text
    assert _detail(download)["message"] == "file_not_found"


async def test_collection_local_upload_rejects_traversal_upload_id(client):
    code, member_token, _member_id = await _create_collection(client)
    init = await _init_file(client, code, member_token)
    assert init.status_code == 200, init.text
    file_id = init.json()["detail"]["file_id"]

    res = await client.post(
        f"/api/collections/{code}/files/{file_id}/parts/0",
        headers={"X-Member-Token": member_token},
        data={"upload_id": "../../escape"},
        files={"chunk": ("blob", b"abc", "application/octet-stream")},
    )

    assert res.status_code == 400, res.text
    assert _detail(res)["message"] in {"invalid_upload_id", "upload_id_mismatch"}


async def test_collection_local_upload_happy_path_completes_and_lists(client):
    code, member_token, member_id = await _create_collection(client)
    init = await _init_file(client, code, member_token, name="hello.txt", size=3)
    assert init.status_code == 200, init.text
    d = init.json()["detail"]
    upload_id = d["upload_id"]
    file_id = d["file_id"]

    part = await client.post(
        f"/api/collections/{code}/files/{file_id}/parts/0",
        headers={"X-Member-Token": member_token},
        data={"upload_id": upload_id},
        files={"chunk": ("blob", b"abc", "application/octet-stream")},
    )
    assert part.status_code == 200, part.text

    complete = await client.post(
        f"/api/collections/{code}/files/{file_id}/complete",
        headers={"X-Member-Token": member_token},
        json={"upload_id": upload_id},
    )
    assert complete.status_code == 200, complete.text
    assert complete.json()["detail"]["id"] == file_id

    listed = await client.get(
        f"/api/collections/{code}/files",
        headers={"X-Member-Token": member_token},
    )
    assert listed.status_code == 200, listed.text
    files = listed.json()["detail"]["files"]
    assert len(files) == 1
    assert files[0]["id"] == file_id
    assert files[0]["member_id"] == member_id
    assert files[0]["name"] == "hello.txt"

    resolver = await client.get(
        f"/api/collections/{code}/files/{file_id}/download",
        headers={"X-Member-Token": member_token},
    )
    assert resolver.status_code == 200, resolver.text
    blob_url = resolver.json()["detail"]["download_url"]
    blob = await client.get(blob_url)
    assert blob.status_code == 200, blob.text
    assert blob.content == b"abc"


async def test_collection_upload_session_bound_to_original_member(client):
    code, owner_token, _owner_id = await _create_collection(client)
    guest_token, _guest_id = await _join_collection(client, code, nickname="guest")

    init = await _init_file(client, code, owner_token)
    assert init.status_code == 200, init.text
    d = init.json()["detail"]
    upload_id = d["upload_id"]
    file_id = d["file_id"]

    guest_part = await client.post(
        f"/api/collections/{code}/files/{file_id}/parts/0",
        headers={"X-Member-Token": guest_token},
        data={"upload_id": upload_id},
        files={"chunk": ("blob", b"abc", "application/octet-stream")},
    )
    assert guest_part.status_code == 403, guest_part.text
    assert _detail(guest_part)["message"] == "forbidden_not_uploader"

    guest_complete = await client.post(
        f"/api/collections/{code}/files/{file_id}/complete",
        headers={"X-Member-Token": guest_token},
        json={"upload_id": upload_id},
    )
    assert guest_complete.status_code == 403, guest_complete.text
    assert _detail(guest_complete)["message"] == "forbidden_not_uploader"


async def test_collection_upload_rejects_wrong_upload_id_for_file(client):
    code, member_token, _member_id = await _create_collection(client)
    init_a = await _init_file(client, code, member_token, name="a.txt")
    init_b = await _init_file(client, code, member_token, name="b.txt")
    assert init_a.status_code == 200, init_a.text
    assert init_b.status_code == 200, init_b.text

    file_a = init_a.json()["detail"]["file_id"]
    upload_b = init_b.json()["detail"]["upload_id"]

    res = await client.post(
        f"/api/collections/{code}/files/{file_a}/complete",
        headers={"X-Member-Token": member_token},
        json={"upload_id": upload_b},
    )

    assert res.status_code == 400, res.text
    assert _detail(res)["message"] == "upload_id_mismatch"


async def test_collection_file_init_rejects_empty_file(client):
    code, member_token, _member_id = await _create_collection(client)

    res = await _init_file(client, code, member_token, size=0)

    assert res.status_code == 400, res.text
    assert _detail(res)["message"] == "empty_file"
