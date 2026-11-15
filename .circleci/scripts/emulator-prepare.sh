#!/usr/bin/env bash
# One compatible system image, KVM verified, one AVD. Mirrors the repo's other emulator gates
# (mobile-apk.yml launch-check, mobile-smoke.yml): API 34, google_apis, x86_64.
#
# KVM is a hard requirement. Without it the emulator falls back to software emulation, which is far too
# slow for this app and would only burn credits before timing out, so this step fails instead.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SYSTEM_IMAGE="system-images;android-34;google_apis;x86_64"
AVD_NAME="ci"
ENV_TXT="$OUT_DIR/env.txt"; : > "$ENV_TXT"

# ---- KVM --------------------------------------------------------------------------------------
[ -e /dev/kvm ] || { echo "FAIL: env: /dev/kvm is missing: this machine has no nested virtualization" | tee -a "$ENV_TXT"; die "no /dev/kvm"; }
sudo chmod 666 /dev/kvm || true
command -v emulator >/dev/null || sdkmanager --install emulator
emulator -accel-check 2>&1 | tee "$OUT_DIR/kvm.txt"
if grep -q "is installed and usable" "$OUT_DIR/kvm.txt"; then
  echo "ok: env: KVM is installed and usable ($(sed -n 's/.*\(KVM (version [0-9]*)\).*/\1/p' "$OUT_DIR/kvm.txt" | head -n1))" | tee -a "$ENV_TXT"
else
  echo "FAIL: env: KVM acceleration is not usable (see kvm.txt)" | tee -a "$ENV_TXT"
  die "KVM not usable"
fi
echo "INFO: env: emulator $(emulator -version 2>/dev/null | sed -n 's/.*emulator version \([0-9.]*\).*/\1/p' | head -n1), image $SYSTEM_IMAGE" | tee -a "$ENV_TXT"

# ---- system image + AVD -----------------------------------------------------------------------
accept_licenses
timed sysimage-install sdkmanager --install "$SYSTEM_IMAGE" "platform-tools" > "$OUT_DIR/sysimage.log" 2>&1 \
  || { tail -n 30 "$OUT_DIR/sysimage.log"; die "could not install $SYSTEM_IMAGE"; }

DEVICES="$(avdmanager list device -c)"   # captured first: `| grep -q` would SIGPIPE avdmanager under pipefail
DEVICE="pixel_6"; grep -qx "$DEVICE" <<<"$DEVICES" || DEVICE="pixel"
echo no | avdmanager --verbose create avd --force -n "$AVD_NAME" -k "$SYSTEM_IMAGE" -d "$DEVICE" > "$OUT_DIR/avd-create.log" 2>&1 \
  || { cat "$OUT_DIR/avd-create.log"; die "avdmanager create avd failed"; }

# 3 GB of the VM's 7.5 GB for the guest; the build is not running now, so there is plenty of room.
CFG="$HOME/.android/avd/$AVD_NAME.avd/config.ini"
set_cfg() { sed -i "/^$1=/d" "$CFG"; echo "$1=$2" >> "$CFG"; }
set_cfg hw.ramSize 3072
set_cfg hw.cpu.ncore 2
set_cfg disk.dataPartition.size 6G
set_cfg hw.keyboard yes       # hardware keyboard: no soft keyboard covering the UI, `adb input text` still works
set_cfg showDeviceFrame no
log "AVD '$AVD_NAME' ($DEVICE) ready:"; grep -E '^(hw.ramSize|hw.cpu.ncore|image.sysdir.1|abi.type|hw.lcd)' "$CFG" || true
