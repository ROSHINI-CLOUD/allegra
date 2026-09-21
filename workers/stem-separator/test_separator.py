"""Unit tests for the GPU-free parts of the worker. Run: python -m unittest test_separator -v"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

from models import resolve_model
from separator import MAX_PAD_TRIM_SAMPLES, StemAlignmentError, _align_stems, _stem_kind

RATE = 44100


def _write(path: Path, samples: int, rate: int = RATE) -> None:
    sf.write(str(path), np.zeros((samples, 2)), rate, subtype="PCM_16")


def _frames(path: Path) -> int:
    return sf.info(str(path)).frames


class StemKindTests(unittest.TestCase):
    def test_demucs_labels(self) -> None:
        self.assertEqual(_stem_kind(Path("song_(Vocals)_htdemucs.wav")), "vocals")
        self.assertEqual(_stem_kind(Path("song_(Drums)_htdemucs.wav")), "instrumental_part")
        self.assertEqual(_stem_kind(Path("song_(Bass)_htdemucs.wav")), "instrumental_part")
        self.assertEqual(_stem_kind(Path("song_(Other)_htdemucs.wav")), "instrumental_part")

    def test_two_stem_labels(self) -> None:
        self.assertEqual(_stem_kind(Path("song_(Instrumental)_model.wav")), "instrumental")
        self.assertEqual(_stem_kind(Path("song_(No Vocals)_model.wav")), "instrumental")

    def test_no_vocals_is_not_vocals(self) -> None:
        self.assertEqual(_stem_kind(Path("song_no_vocals.wav")), "instrumental")


class AlignmentTests(unittest.TestCase):
    def test_equal_lengths_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            v, i = Path(d) / "v.wav", Path(d) / "i.wav"
            _write(v, RATE), _write(i, RATE)
            _align_stems(v, i)
            self.assertEqual(_frames(v), _frames(i))

    def test_small_drift_is_padded_or_trimmed_to_vocals_length(self) -> None:
        for delta in (-100, 100, MAX_PAD_TRIM_SAMPLES, -MAX_PAD_TRIM_SAMPLES):
            with self.subTest(delta=delta), tempfile.TemporaryDirectory() as d:
                v, i = Path(d) / "v.wav", Path(d) / "i.wav"
                _write(v, RATE), _write(i, RATE + delta)
                _align_stems(v, i)
                self.assertEqual(_frames(v), RATE)
                self.assertEqual(_frames(i), RATE)

    def test_large_drift_fails_loudly(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            v, i = Path(d) / "v.wav", Path(d) / "i.wav"
            _write(v, RATE), _write(i, RATE + MAX_PAD_TRIM_SAMPLES + 1)
            with self.assertRaises(StemAlignmentError):
                _align_stems(v, i)

    def test_sample_rate_mismatch_fails(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            v, i = Path(d) / "v.wav", Path(d) / "i.wav"
            _write(v, RATE, RATE), _write(i, 48000, 48000)
            with self.assertRaises(StemAlignmentError):
                _align_stems(v, i)


class ModelAllowlistTests(unittest.TestCase):
    def test_default_and_alias(self) -> None:
        self.assertEqual(resolve_model(None).alias, "htdemucs")
        self.assertEqual(resolve_model("bs-roformer").alias, "bs-roformer")

    def test_arbitrary_checkpoint_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            resolve_model("https://evil.example.com/model.ckpt")


if __name__ == "__main__":
    unittest.main()
