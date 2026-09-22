# Stem-separator GPU worker for AWS Batch (g4dn / NVIDIA T4).
# Build for linux/amd64 only — Batch EC2 GPU hosts are x86_64.
FROM --platform=linux/amd64 nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODEL_DIR=/models \
    WORK_DIR=/tmp/stem-work \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        ffmpeg \
        libsndfile1 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && mkdir -p /models /tmp/stem-work /app

WORKDIR /app

# CUDA 12.1 wheels for T4 (g4dn). Pin torch before audio-separator so the
# [gpu] extra does not resolve to a CPU-only torch build.
RUN pip3 install --upgrade pip setuptools wheel \
    && pip3 install \
        torch==2.3.1 \
        torchvision==0.18.1 \
        torchaudio==2.3.1 \
        --index-url https://download.pytorch.org/whl/cu121

COPY requirements.txt /app/requirements.txt
RUN pip3 install -r /app/requirements.txt

COPY models.py separator.py storage.py worker.py prefetch.py /app/

# Bake allowlisted weights into the image: a scale-from-zero Spot instance would
# otherwise re-download them on every cold start. Build with --build-arg BAKE_MODELS=""
# to skip (weights then download on the first job per instance).
ARG BAKE_MODELS=htdemucs
RUN python /app/prefetch.py ${BAKE_MODELS}

WORKDIR /tmp/stem-work
ENTRYPOINT ["python", "/app/worker.py"]
