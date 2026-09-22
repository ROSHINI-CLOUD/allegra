"""Allowlisted stem-separation models for the Batch worker.

STEM_MODEL is an Allegra alias (or a raw audio-separator filename). Only entries
in ALLOWED_MODELS are accepted at runtime — never download arbitrary checkpoints
from job parameters.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True)
class ModelInfo:
    """Metadata for one allowlisted separator model."""

    alias: str
    # Filename passed to audio_separator.Separator.load_model(...)
    filename: str
    # Two-stem (vocals+instrumental) vs multi-stem Demucs-style outputs.
    stem_layout: str  # "two_stem" | "four_stem" | "six_stem"
    notes: str
    # License / commercial-use caution — verify before production promotion.
    license_note: str


# Baseline: Hybrid Transformer Demucs (Meta). Reliable, MIT via demucs / UVR packaging.
# Candidates for later quality A/B (verify license + commercial suitability first):
#   - model_bs_roformer_ep_317_sdr_12.9755.ckpt  (BS-RoFormer, strong vocals SDR)
#   - vocals_mel_band_roformer.ckpt / melband variants (MelBand-RoFormer)
ALLOWED_MODELS: Mapping[str, ModelInfo] = {
    "htdemucs": ModelInfo(
        alias="htdemucs",
        filename="htdemucs.yaml",
        stem_layout="four_stem",
        notes="Demucs v4 hybrid transformer; baseline for Allegra Sing.",
        license_note=(
            "Demucs (Meta) is MIT-licensed. Confirm the packaged UVR/audio-separator "
            "weights and any third-party checkpoints before commercial use."
        ),
    ),
    "htdemucs.yaml": ModelInfo(
        alias="htdemucs",
        filename="htdemucs.yaml",
        stem_layout="four_stem",
        notes="Raw audio-separator filename alias for htdemucs.",
        license_note=(
            "Demucs (Meta) is MIT-licensed. Confirm packaged weights before commercial use."
        ),
    ),
    # Registered for future benchmarking only — not the default. Operators must
    # confirm license/commercial terms of the specific checkpoint before enabling.
    "bs-roformer": ModelInfo(
        alias="bs-roformer",
        filename="model_bs_roformer_ep_317_sdr_12.9755.ckpt",
        stem_layout="two_stem",
        notes="BS-RoFormer vocal/instrumental candidate; quality A/B vs htdemucs.",
        license_note=(
            "Third-party UVR/community checkpoint — verify source, license, and "
            "commercial-use suitability before production."
        ),
    ),
    "melband-roformer": ModelInfo(
        alias="melband-roformer",
        filename="vocals_mel_band_roformer.ckpt",
        stem_layout="two_stem",
        notes="MelBand-RoFormer vocal candidate; quality A/B vs htdemucs.",
        license_note=(
            "Third-party UVR/community checkpoint — verify source, license, and "
            "commercial-use suitability before production."
        ),
    ),
}

DEFAULT_MODEL_ALIAS = "htdemucs"


def resolve_model(stem_model: str | None) -> ModelInfo:
    """Map STEM_MODEL env/alias to an allowlisted ModelInfo or raise."""
    key = (stem_model or DEFAULT_MODEL_ALIAS).strip()
    if not key:
        key = DEFAULT_MODEL_ALIAS
    info = ALLOWED_MODELS.get(key) or ALLOWED_MODELS.get(key.lower())
    if info is None:
        allowed = ", ".join(sorted({m.alias for m in ALLOWED_MODELS.values()}))
        raise ValueError(f"STEM_MODEL {stem_model!r} is not allowlisted. Allowed: {allowed}")
    return info
