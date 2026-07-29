"""Regression tests for the pickup preview + download disposition contract.

Bug history
-----------
Reported 2026-07-29: sharing a ``.md`` file produced a dialog with no preview,
no raw/rendered toggle, and a "Download" action that opened a viewer tab
instead of saving the file. Three distinct defects sat behind it, and the two
that live in the backend are pinned here:

1. ``/api/share/download/{code}`` always answered ``Content-Disposition:
   inline`` unless the MIME was on the XSS-driven ``FORCE_DOWNLOAD_MIMES``
   list. That inline default is what preview surfaces (``<img>``, ``<video>``,
   ``<iframe>``) need, but it meant *every* download link rendered the file in
   a tab rather than downloading it. Fixed by adding ``?dl=1``, which forces an
   attachment disposition without disturbing the inline preview path.

2. Text-ish files were being classified for preview purely by the MIME that
   Python's ``mimetypes`` guessed. That returns ``None`` for ``.log`` / ``.yaml``
   and non-``text/*`` strings for ``.json`` / ``.py``, so the frontend's
   ``startsWith('text/')`` check dropped most real text shares. The tests below
   pin the *server side* of that contract — the content types actually emitted
   for the common extensions — so a future change to ``_guess_content_type``
   can't silently break the frontend allow-list that consumes them.

The frontend half of the fix lives in ``frontend/src/lib/preview.ts``.
"""
from __future__ import annotations

import pytest


async def _upload(client, filename: str, body: bytes = b"hello\n") -> str:
    """Upload one file via the simple-share endpoint. Returns the pickup code."""
    res = await client.post(
        "/api/share/file",
        files={"file": (filename, body, "application/octet-stream")},
        data={"expire_value": "1", "expire_style": "hour"},
    )
    assert res.status_code == 200, res.text
    return res.json()["detail"]["code"]


class TestDownloadDisposition:
    """``?dl=1`` must flip inline → attachment, and only that."""

    async def test_default_is_inline_so_previews_still_work(self, client) -> None:
        code = await _upload(client, "note.md", b"# Title\n\n- bullet\n")
        res = await client.get(f"/api/share/download/{code}")
        assert res.status_code == 200
        cd = res.headers["content-disposition"]
        assert cd.startswith("inline;"), cd
        # The real content-type must survive so <img>/<iframe> can render it.
        assert res.headers["content-type"].startswith("text/markdown")

    async def test_dl_flag_forces_attachment(self, client) -> None:
        code = await _upload(client, "note.md", b"# Title\n")
        res = await client.get(f"/api/share/download/{code}?dl=1")
        assert res.status_code == 200
        cd = res.headers["content-disposition"]
        assert cd.startswith("attachment;"), cd
        # Attachment responses are handed back as an opaque blob.
        assert res.headers["content-type"] == "application/octet-stream"

    async def test_dl_zero_is_equivalent_to_omitting_it(self, client) -> None:
        code = await _upload(client, "note.txt")
        res = await client.get(f"/api/share/download/{code}?dl=0")
        assert res.headers["content-disposition"].startswith("inline;")

    async def test_filename_is_preserved_in_both_modes(self, client) -> None:
        code = await _upload(client, "report.md")
        for suffix in ("", "?dl=1"):
            res = await client.get(f"/api/share/download/{code}{suffix}")
            cd = res.headers["content-disposition"]
            assert 'filename="report.md"' in cd, cd
            assert "filename*=UTF-8''report.md" in cd, cd

    async def test_cjk_filename_survives_the_dl_path(self, client) -> None:
        """RFC 5987 encoding must still apply when ?dl=1 is set.

        HTTP/1.1 headers are latin-1, so a raw CJK name in ``filename=``
        crashes starlette. The ASCII fallback + ``filename*`` pair has to hold
        on the attachment branch too.
        """
        code = await _upload(client, "报告.md")
        res = await client.get(f"/api/share/download/{code}?dl=1")
        assert res.status_code == 200
        cd = res.headers["content-disposition"]
        assert cd.startswith("attachment;")
        assert "filename*=UTF-8''" in cd
        # ASCII fallback must not contain raw non-latin-1 bytes.
        cd.encode("latin-1")

    async def test_forced_download_mime_stays_attachment_without_the_flag(
        self, client
    ) -> None:
        """The XSS allow-list is independent of ?dl= and must not regress."""
        code = await _upload(client, "page.html", b"<h1>hi</h1>")
        res = await client.get(f"/api/share/download/{code}")
        assert res.headers["content-disposition"].startswith("attachment;")
        assert res.headers["content-type"] == "application/octet-stream"

    @pytest.mark.parametrize("bad", ["2", "-1", "yes"])
    async def test_invalid_dl_values_are_rejected(self, client, bad: str) -> None:
        """``dl`` is bounded to 0/1 so it can't be used to smuggle anything."""
        code = await _upload(client, "note.txt")
        res = await client.get(f"/api/share/download/{code}?dl={bad}")
        assert res.status_code == 422


class TestSelectContentTypes:
    """Pin the content types the frontend preview allow-list is built around."""

    @pytest.mark.parametrize(
        ("filename", "expected_ct"),
        [
            ("a.md", "text/markdown"),
            ("a.txt", "text/plain"),
            ("a.csv", "text/csv"),
            ("a.json", "application/json"),
            ("a.html", "text/html"),
        ],
    )
    async def test_known_extensions_report_their_mime(
        self, client, filename: str, expected_ct: str
    ) -> None:
        code = await _upload(client, filename)
        res = await client.post("/api/share/select", json={"code": code})
        assert res.status_code == 200, res.text
        assert res.json()["detail"]["content_type"] == expected_ct

    @pytest.mark.parametrize("filename", ["a.log", "a.env"])
    async def test_unguessable_extensions_report_null(
        self, client, filename: str
    ) -> None:
        """These are exactly the files the MIME-only frontend check dropped.

        ``mimetypes`` has no entry for them, so ``content_type`` comes back
        ``None`` and the frontend must fall back to the extension allow-list in
        ``lib/preview.ts``.
        """
        code = await _upload(client, filename)
        res = await client.post("/api/share/select", json={"code": code})
        assert res.status_code == 200, res.text
        assert res.json()["detail"]["content_type"] is None

    @pytest.mark.parametrize("filename", ["a.yaml", "a.yml", "a.toml"])
    async def test_environment_dependent_extensions_are_not_relied_upon(
        self, client, filename: str
    ) -> None:
        """``mimetypes`` answers differently depending on the host's mime.types.

        Measured 2026-07-29 on identical CPython 3.12.13:

            developer machine (has /etc/mime.types)  ``.yaml`` → application/yaml
            production container (slim, no mime.types) ``.yaml`` → None

        ``mimetypes.init()`` reads the system mime database at import, so the
        same code returns different content types in dev and prod. This is the
        core reason the frontend must never gate its text preview on the MIME
        alone — ``lib/preview.ts`` treats a null/octet-stream MIME as "consult
        the extension allow-list".

        The assertion is deliberately loose: it pins the *contract* (never a
        binary/undisplayable type) rather than a value that legitimately varies
        by environment, so this test can't go red just because a base image
        started shipping mime-support.
        """
        code = await _upload(client, filename)
        res = await client.post("/api/share/select", json={"code": code})
        assert res.status_code == 200, res.text
        ct = res.json()["detail"]["content_type"]
        assert ct is None or ct.startswith(("text/", "application/")), ct
        # Whatever it resolves to, it must never be force-download: these are
        # plain config files, and forcing an attachment would kill the preview.
        assert res.json()["detail"]["force_download"] is False

    async def test_select_hands_out_the_proxy_url(self, client) -> None:
        """The preview fetch and the download link are built off this URL."""
        code = await _upload(client, "a.md")
        res = await client.post("/api/share/select", json={"code": code})
        detail = res.json()["detail"]
        assert detail["url"] == f"/api/share/download/{code}"
        # force_download stays False for markdown — it is safe to render.
        assert detail["force_download"] is False

    async def test_html_share_is_flagged_force_download(self, client) -> None:
        code = await _upload(client, "a.html", b"<h1>x</h1>")
        res = await client.post("/api/share/select", json={"code": code})
        assert res.json()["detail"]["force_download"] is True
