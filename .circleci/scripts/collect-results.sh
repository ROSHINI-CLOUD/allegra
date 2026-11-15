#!/usr/bin/env bash
# Runs with `when: always`: whatever happened above, keep the evidence. Never fails the job by itself; the
# test step's own exit status is what turns the job red.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
PKG=com.lyricflow.app
a() { timeout 25 adb "$@"; }

mkdir -p "$OUT_DIR/junit" "$OUT_DIR/device"
if a get-state >/dev/null 2>&1; then
  a logcat -d -v threadtime         > "$OUT_DIR/device/logcat-all.txt"   2>&1
  a logcat -d -b crash -v threadtime > "$OUT_DIR/device/logcat-crash.txt" 2>&1
  a exec-out screencap -p           > "$OUT_DIR/device/final-screen.png" 2>/dev/null || rm -f "$OUT_DIR/device/final-screen.png"
  a shell dumpsys package "$PKG"    2>/dev/null | grep -E 'versionName|versionCode|primaryCpuAbi|installerPackageName|flags=' > "$OUT_DIR/device/package.txt"
  a shell dumpsys meminfo "$PKG"    2>/dev/null | head -n 45 > "$OUT_DIR/device/meminfo.txt"
  a shell getprop                   2>/dev/null | grep -E 'ro\.(build\.(version|fingerprint)|product\.(model|cpu\.abi))' > "$OUT_DIR/device/props.txt"
  a shell ls -l /data/anr 2>/dev/null > "$OUT_DIR/device/anr-list.txt"
  echo "crash buffer lines for $PKG: $(grep -c "Process: $PKG" "$OUT_DIR/device/logcat-crash.txt" 2>/dev/null || echo 0)"
else
  echo "no device attached (the emulator never booted or died); only host-side logs exist" | tee "$OUT_DIR/device/NO-DEVICE.txt"
fi

python3 "$(dirname "${BASH_SOURCE[0]}")/results-to-junit.py" "$OUT_DIR/junit/results.xml" \
  "env=$OUT_DIR/env.txt" \
  "launch-check=$OUT_DIR/launch/launch.txt" \
  "miniplayer-flow=$OUT_DIR/flow/controls.txt" || true

echo "-- artifacts"; du -sh "$OUT_DIR" 2>/dev/null; ls "$OUT_DIR" "$OUT_DIR/launch" "$OUT_DIR/flow" 2>/dev/null | head -n 80
exit 0
