#!/usr/bin/env python3
"""Reference Python client for the yui-drop v1 API.

Uploads a file to a yui-drop instance and prints the resulting short URL.
Automatically selects simple upload (≤ ~10 MiB) or multipart presigned
upload (no upper limit besides the server's per-key ``max_file_size``).

Usage:
  yui-drop-upload.py FILE [--expire-value N] [--expire-style STYLE]
                          [--base-url URL] [--api-key KEY]
                          [--concurrency N]

Environment variables:
  YUI_DROP_API_KEY   API key (overridden by --api-key)
  YUI_DROP_BASE_URL  Base URL (default https://drop.leod.me; overridden by --base-url)

Dependencies: only ``requests`` from PyPI.
"""
from __future__ import annotations

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests

# Simple-upload threshold. The server enforces this too — pick a slightly
# conservative client-side value so we fall back to multipart before the
# server rejects us.
SIMPLE_UPLOAD_MAX = 9 * 1024 * 1024  # 9 MiB (server default is ~10 MiB)
DEFAULT_CONCURRENCY = 4
HTTP_TIMEOUT = 60  # seconds, per request


def _check(resp: requests.Response) -> dict[str, Any]:
    """Raise on non-2xx or non-2000 envelope. Return ``detail`` on success."""
    if resp.status_code >= 400:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text}")
    body = resp.json()
    if body.get("code") != 2000:
        raise RuntimeError(f"API error: {body}")
    return body["detail"]


def simple_upload(
    *,
    base_url: str,
    api_key: str,
    path: Path,
    expire_value: int,
    expire_style: str,
) -> dict[str, Any]:
    """One-shot multipart/form-data upload for small files."""
    with path.open("rb") as f:
        resp = requests.post(
            f"{base_url}/api/v1/upload",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (path.name, f, "application/octet-stream")},
            data={
                "expire_value": str(expire_value),
                "expire_style": expire_style,
            },
            timeout=HTTP_TIMEOUT * 5,
        )
    return _check(resp)


def _put_part(
    *,
    presign_url: str,
    body: bytes,
    headers: dict[str, str] | None = None,
) -> str:
    """PUT one part directly to the object store and return its ETag."""
    resp = requests.put(
        presign_url,
        data=body,
        headers=headers or {},
        timeout=HTTP_TIMEOUT * 10,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"part PUT failed: HTTP {resp.status_code}: {resp.text[:200]}")
    etag = resp.headers.get("ETag")
    if not etag:
        raise RuntimeError("part PUT returned no ETag header")
    return etag


def multipart_upload(
    *,
    base_url: str,
    api_key: str,
    path: Path,
    expire_value: int,
    expire_style: str,
    concurrency: int,
) -> dict[str, Any]:
    """R2/S3 multipart presigned upload, concurrent across parts."""
    size = path.stat().st_size
    headers = {"Authorization": f"Bearer {api_key}"}

    # 1. init
    init_resp = requests.post(
        f"{base_url}/api/v1/upload/init",
        headers={**headers, "Content-Type": "application/json"},
        json={
            "file_name": path.name,
            "file_size": size,
            "expire_value": expire_value,
            "expire_style": expire_style,
        },
        timeout=HTTP_TIMEOUT,
    )
    init = _check(init_resp)
    upload_id = init["upload_id"]
    part_size = init["part_size"]
    parts_total = init["parts_total"]

    print(
        f"  multipart: upload_id={upload_id[:10]}... "
        f"parts={parts_total} part_size={part_size:,}",
        file=sys.stderr,
    )

    # 2. sign + PUT each part, in parallel
    def _sign_and_put(part_number: int) -> tuple[int, str]:
        # 2a. sign
        sign_resp = requests.post(
            f"{base_url}/api/v1/upload/{upload_id}/sign-part",
            headers={**headers, "Content-Type": "application/json"},
            json={"part_number": part_number},
            timeout=HTTP_TIMEOUT,
        )
        sign = _check(sign_resp)
        # 2b. read the corresponding byte range
        offset = (part_number - 1) * part_size
        with path.open("rb") as f:
            f.seek(offset)
            chunk = f.read(part_size)
        # 2c. PUT directly to the object store
        etag = _put_part(presign_url=sign["url"], body=chunk, headers=sign.get("headers"))
        return part_number, etag

    parts: list[dict[str, Any]] = []
    try:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [pool.submit(_sign_and_put, n) for n in range(1, parts_total + 1)]
            done = 0
            for fut in as_completed(futures):
                part_number, etag = fut.result()
                parts.append({"part_number": part_number, "etag": etag})
                done += 1
                print(f"  part {done}/{parts_total} uploaded", file=sys.stderr)
    except Exception:
        # 2d. on failure, abort the multipart session so we don't waste storage
        try:
            requests.delete(
                f"{base_url}/api/v1/upload/{upload_id}",
                headers=headers,
                timeout=HTTP_TIMEOUT,
            )
        except Exception:
            pass
        raise

    # 3. complete
    parts.sort(key=lambda p: p["part_number"])
    complete_resp = requests.post(
        f"{base_url}/api/v1/upload/{upload_id}/complete",
        headers={**headers, "Content-Type": "application/json"},
        json={"parts": parts},
        timeout=HTTP_TIMEOUT * 5,
    )
    return _check(complete_resp)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Upload a file to yui-drop and print the short URL.",
    )
    parser.add_argument("file", type=Path, help="Path to the file to upload")
    parser.add_argument(
        "--expire-value", type=int, default=1, help="Expiry numeric value (default 1)",
    )
    parser.add_argument(
        "--expire-style",
        default="day",
        choices=["minute", "hour", "day", "week", "month", "year", "count", "forever"],
        help="Expiry unit (default day)",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("YUI_DROP_BASE_URL", "https://drop.leod.me"),
        help="yui-drop base URL (default $YUI_DROP_BASE_URL or https://drop.leod.me)",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("YUI_DROP_API_KEY"),
        help="API key (default $YUI_DROP_API_KEY)",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=DEFAULT_CONCURRENCY,
        help=f"Parallel multipart workers (default {DEFAULT_CONCURRENCY})",
    )
    args = parser.parse_args()

    if not args.api_key:
        parser.error("API key not provided (use --api-key or YUI_DROP_API_KEY)")
    if not args.file.is_file():
        parser.error(f"not a file: {args.file}")

    size = args.file.stat().st_size
    print(
        f"Uploading {args.file.name} ({size:,} bytes) → {args.base_url}",
        file=sys.stderr,
    )

    if size <= SIMPLE_UPLOAD_MAX:
        result = simple_upload(
            base_url=args.base_url.rstrip("/"),
            api_key=args.api_key,
            path=args.file,
            expire_value=args.expire_value,
            expire_style=args.expire_style,
        )
    else:
        result = multipart_upload(
            base_url=args.base_url.rstrip("/"),
            api_key=args.api_key,
            path=args.file,
            expire_value=args.expire_value,
            expire_style=args.expire_style,
            concurrency=args.concurrency,
        )

    print(result["short_url"])


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
