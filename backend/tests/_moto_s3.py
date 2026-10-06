"""In-process S3 (moto) for tests that exercise the S3 storage path.

moto answers botocore requests from a ``before-send`` hook with a plain
``AWSResponse``; aiobotocore expects awaitable bodies. ``_aio_stubber`` wraps
moto's answer in an ``AioAWSResponse`` so the production ``S3Storage`` class
(aioboto3) runs unmodified against moto's in-memory backend.

The endpoint is plain ``http``: over https botocore streams request bodies
with an aws-chunked checksum trailer, which aiobotocore implements as an
async reader that moto cannot consume.
"""
from __future__ import annotations

import io
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import patch

BUCKET = "yd-test-bucket"
ENDPOINT = "http://s3.amazonaws.com"


class _AsyncBody:
    """Just enough of ``aiohttp.ClientResponse`` for aiobotocore's readers."""

    def __init__(self, data: bytes, url: str) -> None:
        self._buf = io.BytesIO(data)
        self.url = url
        self.content = self

    async def read(self, n: int = -1) -> bytes:
        return self._buf.read() if n is None or n < 0 else self._buf.read(n)

    def close(self) -> None:
        pass

    def release(self) -> None:
        pass


@asynccontextmanager
async def moto_s3_storage() -> AsyncIterator[Any]:
    """Install a moto-backed ``S3Storage`` as the live storage singleton."""
    import os

    from aiobotocore.awsrequest import AioAWSResponse
    from moto import mock_aws
    from moto.core.botocore_stubber import BotocoreStubber

    from app.storage import factory
    from app.storage.s3 import S3Storage

    original_call = BotocoreStubber.__call__

    def _aio_stubber(self, event_name, request, **kwargs):
        resp = original_call(self, event_name, request, **kwargs)
        if resp is None:
            return None
        return AioAWSResponse(
            resp.url, resp.status_code, resp.headers, _AsyncBody(resp.content, resp.url)
        )

    env = {
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_DEFAULT_REGION": "us-east-1",
    }
    with patch.dict(os.environ, env), mock_aws(), patch.object(
        BotocoreStubber, "__call__", _aio_stubber
    ):
        storage = S3Storage(
            bucket=BUCKET,
            endpoint_url=ENDPOINT,
            access_key="testing",
            secret_key="testing",
            region="us-east-1",
        )
        async with storage._client() as s3:
            await s3.create_bucket(Bucket=BUCKET)
        previous = factory._instance
        factory._instance = storage
        try:
            yield storage
        finally:
            factory._instance = previous


async def list_keys(storage: Any) -> list[str]:
    """Every object key currently in the test bucket."""
    async with storage._client() as s3:
        res = await s3.list_objects_v2(Bucket=BUCKET)
    return sorted(o["Key"] for o in res.get("Contents", []))


async def open_multipart_uploads(storage: Any) -> list[str]:
    """Keys of multipart uploads that were started and never completed/aborted."""
    async with storage._client() as s3:
        res = await s3.list_multipart_uploads(Bucket=BUCKET)
    return sorted(u["Key"] for u in res.get("Uploads", []))
