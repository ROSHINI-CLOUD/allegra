#!/usr/bin/env bash
# Waits for the emulator started by emulator-start.sh, with a hard limit. A boot that is not done in
# BOOT_LIMIT seconds will not get better (KVM off, or the VM is starved), and every minute waiting costs credits.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

BOOT_LIMIT="${BOOT_LIMIT:-420}"
ENV_TXT="$OUT_DIR/env.txt"
t0=$SECONDS
# The QEMU process, not this script: `pgrep -f emulator` would match our own command line.
emulator_alive() { pgrep -f 'qemu-system-x86_64' >/dev/null; }
fail() {
  echo "FAIL: env: $1" | tee -a "$ENV_TXT"
  echo "--- emulator.log (tail)"; tail -n 60 "$OUT_DIR/emulator.log" 2>/dev/null || true
  printf '%-28s %5ss rc=1\n' emulator-boot "$((SECONDS - t0))" >> "$OUT_DIR/timings.txt"
  exit 1
}

log "waiting for the emulator (limit ${BOOT_LIMIT}s)"
# The background step may not have launched the process yet.
for _ in $(seq 1 30); do emulator_alive && break; sleep 1; done
emulator_alive || fail "the emulator process never started"

adb start-server >/dev/null 2>&1 || true
timeout "$BOOT_LIMIT" adb wait-for-device || fail "no device appeared within ${BOOT_LIMIT}s"

while [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do
  [ $((SECONDS - t0)) -lt "$BOOT_LIMIT" ] || fail "sys.boot_completed was not 1 after ${BOOT_LIMIT}s"
  emulator_alive || fail "the emulator process died while booting"
  sleep 5
done
# The package manager answers a little after boot_completed.
until adb shell pm path android >/dev/null 2>&1; do
  [ $((SECONDS - t0)) -lt "$BOOT_LIMIT" ] || fail "the package manager never answered"
  sleep 2
done
adb shell input keyevent KEYCODE_WAKEUP || true
adb shell wm dismiss-keyguard || true

BOOT=$((SECONDS - t0))
printf '%-28s %5ss rc=0\n' emulator-boot "$BOOT" >> "$OUT_DIR/timings.txt"
ABI="$(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
echo "ok: env: emulator booted in ${BOOT}s (limit ${BOOT_LIMIT}s), Android $(adb shell getprop ro.build.version.release | tr -d '\r') API $(adb shell getprop ro.build.version.sdk | tr -d '\r'), CPU ABI $ABI" | tee -a "$ENV_TXT"
[ "$ABI" = "x86_64" ] || fail "the emulator CPU ABI is '$ABI', expected x86_64"
