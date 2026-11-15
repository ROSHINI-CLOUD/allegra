#!/usr/bin/env bash
# Runs on the booted emulator, installs the APK from the build job and runs:
#   A. the repo's own release gate, .github/scripts/mobile-launch-check.sh (cold start, deep links navigate,
#      About -> Updates, Now Playing, force-stop and start again)
#   B. .circleci/scripts/miniplayer-flow.sh (mini-player -> Now Playing -> dismiss, with a deterministic track)
#
# Results: $CI_OUT_DIR/{env,launch/launch,flow/controls}.txt as `ok:` / `FAIL:` / `GAP:` / `INFO:` lines, converted
# to JUnit by collect-results.sh. Every stage always runs, and the exit status is non-zero if any check failed.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

PKG=com.lyricflow.app
APK="${1:-$(ls -1 "$ARTIFACT_DIR"/LuvLyrics-preview-*-universal.apk 2>/dev/null | head -n1)}"
[ -f "$APK" ] || die "no preview APK in $ARTIFACT_DIR: did attach_workspace run?"
ENV_TXT="$OUT_DIR/env.txt"
mkdir -p "$OUT_DIR/launch" "$OUT_DIR/flow"

echo "INFO: env: tested artifact $(basename "$APK") sha256 $(sha256sum "$APK" | cut -d' ' -f1)" | tee -a "$ENV_TXT"

# The launch gate and the flow both read a still screen and report through logcat: record the device clock skew-free start.
adb logcat -c || true

# ---- A. the repo's launch gate ---------------------------------------------------------------
log "A. launch check"
# Vulkan renderer, as mobile-apk.yml does: on GLES the emulator's GL pipe can deadlock a draw (documented in apps/mobile/CLAUDE.md).
adb shell setprop debug.hwui.renderer skiavk || true
timed launch-check timeout 1200 bash "$REPO_ROOT/.github/scripts/mobile-launch-check.sh" "$APK" "$OUT_DIR/launch"
LAUNCH_RC=$?
if [ "$LAUNCH_RC" -eq 124 ]; then echo "FAIL: launch-check hit its 20 minute limit" | tee -a "$OUT_DIR/launch/launch.txt"; fi
log "launch check finished with $LAUNCH_RC failed checks"

# Which native slice actually ran: the installed package's primary ABI.
PRIMARY="$(adb shell dumpsys package "$PKG" 2>/dev/null | grep -m1 -o 'primaryCpuAbi=[A-Za-z0-9_-]*' | cut -d= -f2)"
if [ "$PRIMARY" = "x86_64" ]; then
  echo "ok: env: the installed app runs its x86_64 libraries (primaryCpuAbi=x86_64); this is the slice the emulator tested" | tee -a "$ENV_TXT"
else
  echo "FAIL: env: the installed app's primaryCpuAbi is '${PRIMARY:-unknown}', expected x86_64" | tee -a "$ENV_TXT"
fi

# ---- B. mini-player -> Now Playing -> dismiss ----------------------------------------------------
log "B. mini-player flow"
timed miniplayer-flow bash "$REPO_ROOT/.circleci/scripts/miniplayer-flow.sh" "$OUT_DIR/flow"
FLOW_RC=$?

# ---- coverage this run cannot give -----------------------------------------------------------------
{
  echo "GAP: env: the arm64-v8a slice is verified statically (libraries present, same names as x86_64) but NOT executed: an x86_64 emulator cannot run arm64 code. Install the APK on a physical arm64 phone for that."
  echo "GAP: env: the emulator runs with -noaudio, so audible output is not checked; the app's own playback state and the media session are."
  echo "GAP: launch-check: its Now Playing stage plays a LIVE track (lyricflow://play?q=...); with no network or a provider outage it logs nothing and passes, so it proves the screen stays alive, not that streaming works."
} | tee -a "$ENV_TXT"

FAILS="$(cat "$ENV_TXT" "$OUT_DIR/launch/launch.txt" "$OUT_DIR/flow/controls.txt" 2>/dev/null | grep -c '^FAIL:' || true)"
{
  echo "== android-preview emulator results"
  echo "launch-check   : $LAUNCH_RC failed"
  echo "mini-player    : $FLOW_RC (0 = pass)"
  echo "FAIL lines     : $FAILS"
  echo "-- timings"; cat "$OUT_DIR/timings.txt" 2>/dev/null
} | tee "$OUT_DIR/summary.txt"

[ "$FAILS" -eq 0 ] && [ "$LAUNCH_RC" -eq 0 ] && [ "$FLOW_RC" -eq 0 ]
