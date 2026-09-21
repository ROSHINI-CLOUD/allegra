"""S3 download/upload helpers for the stem-separator worker."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Mapping

import boto3
from botocore.client import BaseClient

log = logging.getLogger("stem-separator.storage")


def s3_client(region: str | None = None) -> BaseClient:
    """Build a boto3 S3 client. Prefers the task/instance IAM role (no embedded keys)."""
    kwargs: dict[str, Any] = {}
    if region:
        kwargs["region_name"] = region
    return boto3.client("s3", **kwargs)


def download_object(client: BaseClient, bucket: str, key: str, dest: Path) -> int:
    """Download an S3 object to dest. Returns bytes written."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    log.info("s3_get bucket=%s key=%s dest=%s", bucket, key, dest)
    client.download_file(bucket, key, str(dest))
    size = dest.stat().st_size
    if size <= 0:
        raise RuntimeError(f"Downloaded empty object s3://{bucket}/{key}")
    return size


def upload_file(
    client: BaseClient,
    bucket: str,
    key: str,
    src: Path,
    content_type: str,
) -> None:
    """Upload a local file to S3 with ContentType."""
    if not src.is_file() or src.stat().st_size <= 0:
        raise RuntimeError(f"Refusing to upload missing/empty file: {src}")
    log.info("s3_put bucket=%s key=%s src=%s bytes=%s", bucket, key, src, src.stat().st_size)
    client.upload_file(
        str(src),
        bucket,
        key,
        ExtraArgs={"ContentType": content_type},
    )


def upload_json(client: BaseClient, bucket: str, key: str, payload: Mapping[str, Any]) -> None:
    """Upload a JSON document (UTF-8) to S3."""
    body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
    log.info("s3_put_json bucket=%s key=%s bytes=%s", bucket, key, len(body))
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json",
    )


def stem_prefix(track_id: str, fingerprint: str, version: str) -> str:
    """Deterministic output prefix: karaoke/{trackId}/{fingerprint}/{version}/"""
    return f"karaoke/{track_id}/{fingerprint}/{version}"
