"""Wrap audio-separator for dual-stem (vocals + instrumental) output.

Prefers two-stem models. When a Demucs-style 4/6-stem model is used, non-vocal
stems are mixed into a single instrumental track so the player only ever sees
vocals.m4a + instrumental.m4a.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from models import ModelInfo, resolve_model

log = logging.getLogger("stem-separator.separator")

VOCAL_LABELS = {"vocals", "vocal"}
DIRECT_INSTRUMENTAL_LABELS = {"instrumental", "no_vocals", "novocals", "no vocals"}
PART_LABELS = {"drums", "bass", "other", "guitar", "piano"}


# Stems from one model run should be identical in length; allow only codec-padding-scale
# differences, and fix those by pad/trim so both files share one exact timeline.
MAX_PAD_TRIM_SAMPLES = 2048


class StemAlignmentError(RuntimeError):
    """Vocals and instrumental cannot be put on the same timeline."""


@dataclass(frozen=True)
class SeparationResult:
    vocals_wav: Path
    instrumental_wav: Path
    model_load_ms: int
    inference_ms: int
    model: ModelInfo


def _stem_kind(path: Path) -> str | None:
    """Classify an audio-separator output path as vocals / instrumental / part.

    Prefer parenthesized labels like ``track_(Vocals)_htdemucs.wav``. Avoid
    matching the substring ``vocals`` inside ``no_vocals``.
    """
    name = path.stem.lower()
    paren = re.search(r"\(([^)]+)\)", name)
    label = paren.group(1).strip().lower().replace(" ", "_") if paren else ""

    if label in VOCAL_LABELS:
        return "vocals"
    if label in DIRECT_INSTRUMENTAL_LABELS or label.replace("_", " ") in DIRECT_INSTRUMENTAL_LABELS:
        return "instrumental"
    if label in PART_LABELS:
        return "instrumental_part"

    if re.search(r"(^|_|-)(no[_-]?vocals?)(_|-|$)", name):
        return "instrumental"
    if re.search(r"(^|_|-)(vocals?)(_|-|$)", name):
        return "vocals"
    if re.search(r"(^|_|-)(instrumental)(_|-|$)", name):
        return "instrumental"
    for part in PART_LABELS:
        if re.search(rf"(^|_|-)({part})(_|-|$)", name):
            return "instrumental_part"
    return None

def _read_audio(path: Path) -> tuple[np.ndarray, int]:
    data, rate = sf.read(str(path), always_2d=True)
    return data.astype(np.float64, copy=False), int(rate)


def _write_audio(path: Path, data: np.ndarray, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), data, sample_rate, subtype="PCM_16")


def _mix_to_instrumental(paths: list[Path], out_path: Path) -> Path:
    if not paths:
        raise RuntimeError("No non-vocal stems to mix into instrumental")
    mixed: np.ndarray | None = None
    rate: int | None = None
    for p in paths:
        data, sr = _read_audio(p)
        if rate is None:
            rate = sr
            mixed = np.zeros_like(data, dtype=np.float64)
        elif sr != rate:
            raise RuntimeError(f"Sample-rate mismatch mixing {p}: {sr} vs {rate}")
        assert mixed is not None
        # Align length on the shorter axis if off-by-one samples appear.
        n = min(mixed.shape[0], data.shape[0])
        c = min(mixed.shape[1], data.shape[1])
        if mixed.shape != data.shape:
            resized = np.zeros((max(mixed.shape[0], data.shape[0]), max(mixed.shape[1], data.shape[1])))
            resized[: mixed.shape[0], : mixed.shape[1]] += mixed
            resized[: data.shape[0], : data.shape[1]] += data
            mixed = resized
        else:
            mixed[:n, :c] += data[:n, :c]
    assert mixed is not None and rate is not None
    peak = float(np.max(np.abs(mixed))) if mixed.size else 0.0
    if peak > 1.0:
        mixed = mixed / peak
    _write_audio(out_path, mixed, rate)
    return out_path


def _align_stems(vocals_path: Path, instrumental_path: Path) -> None:
    """Force both stems onto one exact sample count, or fail loudly.

    Vocals and instrumental must be sample-aligned for the browser to mix them; a
    silent 1 s drift is far worse than a failed job that can be retried.
    """
    v_data, v_rate = _read_audio(vocals_path)
    i_data, i_rate = _read_audio(instrumental_path)
    if v_rate != i_rate:
        raise StemAlignmentError(f"Stem sample-rate mismatch: vocals={v_rate} instrumental={i_rate}")

    delta = i_data.shape[0] - v_data.shape[0]
    if delta == 0:
        return
    if abs(delta) > MAX_PAD_TRIM_SAMPLES:
        raise StemAlignmentError(
            f"Stem length mismatch: vocals={v_data.shape[0]} instrumental={i_data.shape[0]} @ {v_rate}Hz"
        )
    target = v_data.shape[0]
    if delta > 0:
        i_data = i_data[:target]
    else:
        pad = np.zeros((target - i_data.shape[0], i_data.shape[1]), dtype=i_data.dtype)
        i_data = np.concatenate([i_data, pad], axis=0)
    _write_audio(instrumental_path, i_data, i_rate)
    log.info("stems_aligned delta_samples=%s target_samples=%s", delta, target)


def separate_to_wavs(
    source_path: Path,
    output_dir: Path,
    stem_model: str | None,
    model_file_dir: Path | None = None,
) -> SeparationResult:
    """Run separation and return paths to vocals.wav + instrumental.wav."""
    from audio_separator.separator import Separator

    model = resolve_model(stem_model)
    output_dir.mkdir(parents=True, exist_ok=True)
    model_dir = model_file_dir or Path("/models")
    model_dir.mkdir(parents=True, exist_ok=True)

    # Emit WAV from the library; worker encodes AAC/M4A afterward.
    separator = Separator(
        model_file_dir=str(model_dir),
        output_dir=str(output_dir),
        output_format="WAV",
        sample_rate=44100,
    )

    t0 = time.perf_counter()
    log.info("loading_model alias=%s filename=%s", model.alias, model.filename)
    separator.load_model(model_filename=model.filename)
    model_load_ms = int((time.perf_counter() - t0) * 1000)

    t1 = time.perf_counter()
    log.info("inference_start source=%s", source_path)
    output_files = separator.separate(str(source_path))
    inference_ms = int((time.perf_counter() - t1) * 1000)
    log.info("inference_done files=%s inference_ms=%s", output_files, inference_ms)

    paths = [Path(p) for p in output_files]
    vocals: Path | None = None
    instrumental: Path | None = None
    parts: list[Path] = []

    for p in paths:
        kind = _stem_kind(p)
        if kind == "vocals":
            vocals = p
        elif kind == "instrumental":
            instrumental = p
        elif kind == "instrumental_part":
            parts.append(p)
        else:
            log.warning("unclassified_stem path=%s — treating as instrumental part", p)
            parts.append(p)

    if vocals is None:
        raise RuntimeError(f"Separation produced no vocals stem from: {paths}")

    vocals_out = output_dir / "vocals.wav"
    instrumental_out = output_dir / "instrumental.wav"

    if vocals.resolve() != vocals_out.resolve():
        data, rate = _read_audio(vocals)
        _write_audio(vocals_out, data, rate)
    else:
        vocals_out = vocals

    if instrumental is not None:
        data, rate = _read_audio(instrumental)
        _write_audio(instrumental_out, data, rate)
    elif parts:
        # 4-stem / 6-stem: mix drums+bass+other(+guitar/piano) → instrumental
        _mix_to_instrumental(parts, instrumental_out)
    else:
        raise RuntimeError(f"Separation produced no instrumental material from: {paths}")

    _align_stems(vocals_out, instrumental_out)

    return SeparationResult(
        vocals_wav=vocals_out,
        instrumental_wav=instrumental_out,
        model_load_ms=model_load_ms,
        inference_ms=inference_ms,
        model=model,
    )
