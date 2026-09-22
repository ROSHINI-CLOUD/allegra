"""Build-time weight download so Spot instances never fetch models on a cold start.

Usage (Dockerfile): python prefetch.py htdemucs [alias ...]
Only allowlisted aliases from models.py are accepted. Runs on CPU — the build
machine has no GPU; weights are the same either way.
"""

from __future__ import annotations

import sys
from pathlib import Path

from audio_separator.separator import Separator

from models import resolve_model

MODEL_DIR = Path("/models")


def main(aliases: list[str]) -> int:
    for alias in aliases:
        model = resolve_model(alias)
        print(f"prefetch alias={model.alias} filename={model.filename}", flush=True)
        separator = Separator(model_file_dir=str(MODEL_DIR), output_dir="/tmp")
        separator.load_model(model_filename=model.filename)
    return 0


if __name__ == "__main__":
    sys.exit(main([a for a in sys.argv[1:] if a.strip()]))
