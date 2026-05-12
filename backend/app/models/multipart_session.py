"""MultipartSession: an open S3 multipart-upload tracked server-side."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


class MultipartSession(Base):
    """One row per ``CreateMultipartUpload`` that hasn't completed or aborted.

    ``parts_uploaded`` is a JSON object of ``{"<part_number>": "<etag>"}``
    accumulated as each PUT-Part succeeds; on completion the server orders by
    part number and submits the manifest to S3. ``expires_at`` is the wall-clock
    deadline used by the orphan sweeper.
    """

    __tablename__ = "multipart_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Our logical upload id (returned to the client; opaque).
    upload_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)

    # Final storage key (== bucket key) once completed.
    key: Mapped[str] = mapped_column(String(1024), nullable=False)

    # File metadata captured at init.
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Multipart structure.
    parts_total: Mapped[int] = mapped_column(Integer, nullable=False)
    # JSON {"<part_number>": "<etag>"} — populated as each PUT-Part finishes.
    parts_uploaded: Mapped[dict | None] = mapped_column(JSON, nullable=True, default=dict)

    # The upstream provider's multipart id (S3 UploadId).
    s3_upload_id: Mapped[str] = mapped_column(String(255), nullable=False)

    # Expiry policy chosen at init, applied on complete.
    expire_value: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    expire_style: Mapped[str] = mapped_column(String(16), nullable=False, default="day")

    # Audit
    created_by_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Wall-clock deadline; rows past this are aborted by the sweeper.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
