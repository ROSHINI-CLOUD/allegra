#!/usr/bin/env bash
# Shared helpers for the android-preview workflow. Source it; do not run it.
#
#   CI_OUT_DIR    logs, reports, screenshots (uploaded as artifacts)   default $HOME/ci-out
#   CI_ARTIFACTS  the APK (uploaded and handed to the test job)        default $HOME/artifacts

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
OUT_DIR="${CI_OUT_DIR:-$HOME/ci-out}"
ARTIFACT_DIR="${CI_ARTIFACTS:-$HOME/artifacts}"
mkdir -p "$OUT_DIR" "$ARTIFACT_DIR"

# CircleCI sources $BASH_ENV before every run step; that is how an export survives to the next step.
: "${BASH_ENV:=$OUT_DIR/bash_env}"
touch "$BASH_ENV"

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

# persist_env NAME VALUE: make an export visible to later steps.
persist_env() { printf 'export %s=%q\n' "$1" "$2" >> "$BASH_ENV"; }

# timed LABEL CMD...: run CMD, append "LABEL <seconds>s rc=<status>" to timings.txt, keep CMD's status.
timed() {
  local label="$1"; shift
  local t0=$SECONDS rc=0
  "$@" || rc=$?
  printf '%-28s %5ss rc=%s\n' "$label" "$((SECONDS - t0))" "$rc" >> "$OUT_DIR/timings.txt"
  return "$rc"
}

# sdk_root: where the Android SDK lives on this image.
sdk_root() {
  local d
  for d in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}"; do
    [ -n "$d" ] && [ -d "$d" ] && { echo "$d"; return 0; }
  done
  d="$(command -v sdkmanager || true)"
  [ -n "$d" ] && { readlink -f "$d" | sed 's#/cmdline-tools/.*##'; return 0; }
  return 1
}

# accept_licenses: `yes | sdkmanager --licenses` without tripping pipefail on SIGPIPE.
accept_licenses() {
  ( set +o pipefail; yes 2>/dev/null | sdkmanager --licenses >/dev/null 2>&1 ) || true
}
