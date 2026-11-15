#!/usr/bin/env bash
# apps/mobile is not a root workspace: it has its own lockfile, so install there (as mobile-apk.yml does).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
cd "$MOBILE_DIR"
timed npm-ci npm ci --prefer-offline --no-audit --no-fund
