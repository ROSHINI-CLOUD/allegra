#!/usr/bin/env bash
# Runs in a `background: true` step: the emulator process lives as long as the job. Its output goes to a
# file (uploaded as an artifact), not to the step log.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# -accel on        fail loudly if KVM is missing instead of silently emulating in software
# -no-snapshot     cold boot every time. The snapshot cache is deliberately not used until the measured
#                  boot time (timings.txt, "emulator-boot") shows it would save enough to be worth its storage.
# -gpu swiftshader_indirect, -noaudio, -no-boot-anim, -camera-back none: the flags the repo's other emulator gates use.
exec emulator -avd ci -no-window -accel on -no-snapshot -gpu swiftshader_indirect \
  -noaudio -no-boot-anim -camera-back none -memory 3072 -cores 2 \
  > "$OUT_DIR/emulator.log" 2>&1
