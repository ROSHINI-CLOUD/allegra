#!/usr/bin/env python3
"""AWS Batch entrypoint: download source → separate → AAC encode → upload stems.

Required env:
  TRACK_ID, SOURCE_OBJECT, SOURCE_FINGERPRINT, STEM_MODEL,
  SEPARATION_VERSION, KARAOKE_S3_BUCKET

Optional:
  AWS_REGION / AWS_DEFAULT_REGION, WORKER_VERSION, MODEL_DIR, WORK_DIR
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

from separator import StemAlignmentError, separate_to_wavs
from storage import download_object, s3_client, stem_prefix, upload_file, upload_json

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("stem-separator.worker")

WORKER_VERSION = os.environ.get("WORKER_VERSION", "1")
AAC_BITRATE = "192k"
SAMPLE_RATE = "44100"
MIN_SOURCE_SECONDS = 1.0
MAX_SOURCE_SECONDS = 20 * 60
# Encoded stems must agree to within one AAC frame (~23 ms) or they will drift in the browser.
MAX_STEM_DURATION_DELTA_S = 0.05

# Exit codes are the contract with the API (aws-batch.provider.ts EXIT_CODE_ERRORS):
# Batch surfaces container.exitCode, which is how failures are classified without
# parsing logs. Anything else exits 1 -> MODEL_FAILURE.
EXIT_INVALID_AUDIO = 10
EXIT_MODEL_FAILURE = 11
EXIT_STORAGE_FAILURE = 12
EXIT_OUTPUT_MISMATCH = 13


class WorkerError(Exception):
    """A classified job failure carrying the process exit code."""

    def __init__(self, exit_code: int, error_code: str, message: str) -> None:
        super().__init__(message)
        self.exit_code = exit_code
        self.error_code = error_code


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _ms_since(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


def _encode_aac(wav_path: Path, m4a_path: Path) -> None:
    """Encode WAV → AAC-in-M4A with ffmpeg. Same flags for both stems to keep timelines aligned."""
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(wav_path),
        "-ar",
        SAMPLE_RATE,
        "-ac",
        "2",
        "-c:a",
        "aac",
        "-b:a",
        AAC_BITRATE,
        "-movflags",
        "+faststart",
        str(m4a_path),
    ]
    log.info("ffmpeg_encode %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed ({result.returncode}): {result.stderr.strip()}")
    if not m4a_path.is_file() or m4a_path.stat().st_size <= 0:
        raise RuntimeError(f"ffmpeg produced empty output: {m4a_path}")


def _probe_duration_seconds(path: Path) -> float | None:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return None
    try:
        return float(result.stdout.strip())
    except ValueError:
        return None


def run() -> None:
    job_t0 = time.perf_counter()
    timings: dict[str, int] = {
        "input_download_ms": 0,
        "model_load_ms": 0,
        "inference_ms": 0,
        "encoding_ms": 0,
        "upload_ms": 0,
        "total_job_ms": 0,
    }

    track_id = _require_env("TRACK_ID")
    source_object = _require_env("SOURCE_OBJECT")
    fingerprint = _require_env("SOURCE_FINGERPRINT")
    stem_model = _require_env("STEM_MODEL")
    separation_version = _require_env("SEPARATION_VERSION")
    bucket = _require_env("KARAOKE_S3_BUCKET")
    region = (
        os.environ.get("AWS_REGION", "").strip()
        or os.environ.get("AWS_DEFAULT_REGION", "").strip()
        or None
    )
    model_dir = Path(os.environ.get("MODEL_DIR", "/models"))
    work_root = Path(os.environ.get("WORK_DIR", "/tmp/stem-work"))
    model_dir.mkdir(parents=True, exist_ok=True)
    work_root.mkdir(parents=True, exist_ok=True)

    work_dir = Path(tempfile.mkdtemp(prefix="job-", dir=str(work_root)))
    log.info(
        "job_start track_id=%s fingerprint=%s model=%s version=%s bucket=%s work_dir=%s",
        track_id,
        fingerprint,
        stem_model,
        separation_version,
        bucket,
        work_dir,
    )

    try:
        client = s3_client(region)
        source_path = work_dir / "source"
        # Preserve extension hint from key when present (helps demucs/ffmpeg sniffing).
        suffix = Path(source_object).suffix
        if suffix and len(suffix) <= 5:
            source_path = work_dir / f"source{suffix}"

        t_dl = time.perf_counter()
        try:
            size = download_object(client, bucket, source_object, source_path)
        except Exception as exc:  # noqa: BLE001 - classify every S3 failure
            raise WorkerError(EXIT_STORAGE_FAILURE, "UPLOAD_FAILURE", f"source download failed: {exc}") from exc
        timings["input_download_ms"] = _ms_since(t_dl)
        log.info("input_downloaded bytes=%s input_download_ms=%s", size, timings["input_download_ms"])

        source_seconds = _probe_duration_seconds(source_path)
        if source_seconds is None or not (MIN_SOURCE_SECONDS <= source_seconds <= MAX_SOURCE_SECONDS):
            raise WorkerError(
                EXIT_INVALID_AUDIO,
                "INVALID_AUDIO",
                f"source is not usable audio (duration={source_seconds})",
            )

        sep_dir = work_dir / "separated"
        try:
            result = separate_to_wavs(
                source_path=source_path,
                output_dir=sep_dir,
                stem_model=stem_model,
                model_file_dir=model_dir,
            )
        except StemAlignmentError as exc:
            raise WorkerError(EXIT_OUTPUT_MISMATCH, "OUTPUT_MISMATCH", str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 - classify every model/CUDA failure
            raise WorkerError(EXIT_MODEL_FAILURE, "MODEL_FAILURE", f"separation failed: {exc}") from exc
        timings["model_load_ms"] = result.model_load_ms
        timings["inference_ms"] = result.inference_ms

        vocals_m4a = work_dir / "vocals.m4a"
        instrumental_m4a = work_dir / "instrumental.m4a"
        t_enc = time.perf_counter()
        _encode_aac(result.vocals_wav, vocals_m4a)
        _encode_aac(result.instrumental_wav, instrumental_m4a)
        timings["encoding_ms"] = _ms_since(t_enc)
        log.info("encoding_done encoding_ms=%s", timings["encoding_ms"])

        duration = _probe_duration_seconds(vocals_m4a)
        instrumental_duration = _probe_duration_seconds(instrumental_m4a)
        if (
            duration is None
            or instrumental_duration is None
            or abs(duration - instrumental_duration) > MAX_STEM_DURATION_DELTA_S
        ):
            raise WorkerError(
                EXIT_OUTPUT_MISMATCH,
                "OUTPUT_MISMATCH",
                f"encoded stems differ in length (vocals={duration}s instrumental={instrumental_duration}s)",
            )
        prefix = stem_prefix(track_id, fingerprint, separation_version)
        vocals_key = f"{prefix}/vocals.m4a"
        instrumental_key = f"{prefix}/instrumental.m4a"
        manifest_key = f"{prefix}/manifest.json"

        manifest = {
            "trackId": track_id,
            "sourceFingerprint": fingerprint,
            "sourceObject": source_object,
            "model": result.model.alias,
            "modelFilename": result.model.filename,
            "modelVersion": separation_version,
            "separationVersion": separation_version,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "duration": duration,
            "workerVersion": WORKER_VERSION,
            "timingsMs": {
                "input_download_ms": timings["input_download_ms"],
                "model_load_ms": timings["model_load_ms"],
                "inference_ms": timings["inference_ms"],
                "encoding_ms": timings["encoding_ms"],
            },
        }

        t_up = time.perf_counter()
        try:
            upload_file(client, bucket, vocals_key, vocals_m4a, "audio/mp4")
            upload_file(client, bucket, instrumental_key, instrumental_m4a, "audio/mp4")
            timings["upload_ms"] = _ms_since(t_up)
            manifest["timingsMs"]["upload_ms"] = timings["upload_ms"]
            # The manifest is the readiness sentinel the API looks for, so it must be
            # written strictly after both stems: its existence implies both are complete.
            upload_json(client, bucket, manifest_key, manifest)
        except Exception as exc:  # noqa: BLE001 - classify every S3 failure
            raise WorkerError(EXIT_STORAGE_FAILURE, "UPLOAD_FAILURE", f"upload failed: {exc}") from exc

        timings["total_job_ms"] = _ms_since(job_t0)
        log.info(
            "job_success track_id=%s vocals=%s instrumental=%s "
            "input_download_ms=%s model_load_ms=%s inference_ms=%s "
            "encoding_ms=%s upload_ms=%s total_job_ms=%s",
            track_id,
            vocals_key,
            instrumental_key,
            timings["input_download_ms"],
            timings["model_load_ms"],
            timings["inference_ms"],
            timings["encoding_ms"],
            timings["upload_ms"],
            timings["total_job_ms"],
        )
    finally:
        try:
            shutil.rmtree(work_dir, ignore_errors=True)
            log.info("temp_cleaned path=%s", work_dir)
        except Exception:  # noqa: BLE001 — best-effort cleanup
            log.warning("temp_cleanup_failed path=%s", work_dir)


def main() -> int:
    try:
        run()
        return 0
    except WorkerError as exc:
        log.error(json.dumps({"event": "job_failed", "errorCode": exc.error_code, "message": str(exc)}))
        traceback.print_exc()
        return exc.exit_code
    except Exception as exc:  # noqa: BLE001 - Batch needs a nonzero exit on any failure
        log.error(json.dumps({"event": "job_failed", "errorCode": "MODEL_FAILURE", "message": str(exc)}))
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
