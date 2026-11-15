#!/usr/bin/env bash
# mini-player -> Now Playing -> dismiss back to the mini-player, on a connected emulator.
#
#   miniplayer-flow.sh <out-dir>        results: <out-dir>/controls.txt  (ok: / FAIL: / GAP: / INFO: lines)
#                                       exit status: 0 only if nothing failed
#
# The track. The repo has no test fixture, and `lyricflow://play?q=` goes through live YouTube Music search and
# live catalog audio. So the deterministic path imports a generated 30 s WAV through the app's own
# "Add songs from this phone" flow: no network, no account, no credentials. If that cannot be set up, the step
# fails (the app or the fixture is broken) and the flow still tries the live path so one run gives more evidence,
# clearly labelled live and non-deterministic. If neither yields a track the flow reports a GAP.
#
# Selectors are the app's own accessibility labels and visible text, not coordinates:
#   "Add songs from this phone" (LibraryScreen)   "Select songs (n/m)", "Select all", "Search songs...", "Import n"
#   (SettingsScreen)   song row "<title> by <artist>" (SongRow)   "Now playing: <title>. Open player"
#   (playback/miniPlayerLabel.ts)   "Up next" (NowPlayingControls, not on the mini-player)   "Close player"
set -u
OUT="${1:-flow}"
mkdir -p "$OUT"; : > "$OUT/controls.txt"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG=com.lyricflow.app

ADB_BIN="$(command -v adb)"
adb() { timeout 60 "$ADB_BIN" "$@"; }
step() { echo "== $(date +%H:%M:%S) $1" | tee -a "$OUT/controls.txt"; }
link() { adb shell "am start -W -a android.intent.action.VIEW -d '$1' $PKG" >/dev/null 2>&1; }
shot() { adb exec-out screencap -p > "$OUT/$1.png"; [ -s "$OUT/$1.png" ] || rm -f "$OUT/$1.png"; }

# shellcheck source=../../.github/scripts/player-assertions.sh
source "$HERE/../../.github/scripts/player-assertions.sh"
# shellcheck source=ui-helpers.sh
source "$HERE/ui-helpers.sh"

FIXTURE="luvlyrics-fixture"
PILL_RE='Now playing: [^"]+\. Open player'
ROUNDS="${ROUNDS:-2}"

# --- the fixture -------------------------------------------------------------------------------
seed_fixture() {
  local wav="$OUT/$FIXTURE.wav"
  python3 - "$wav" <<'PY'
import math, struct, sys, wave
rate, seconds = 22050, 30            # a 440 Hz tone, identical on every run
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
    w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(rate * seconds)))
PY
  [ -s "$wav" ] || { step_fail "fixture: could not generate the WAV"; return 1; }
  adb shell mkdir -p /sdcard/Music
  adb push "$wav" "/sdcard/Music/$FIXTURE.wav" >/dev/null || { step_fail "fixture: adb push failed"; return 1; }
  # MediaStore only learns about a pushed file when told. Try every route; one is enough.
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Music/$FIXTURE.wav" >/dev/null 2>&1
  adb shell content call --uri content://media --method scan_volume --arg external_primary >/dev/null 2>&1
  local i
  for i in $(seq 1 30); do
    adb shell content query --uri content://media/external/audio/media --projection _display_name 2>/dev/null | grep -q "$FIXTURE" && {
      _record "ok: fixture: $FIXTURE.wav (30 s, 440 Hz, generated) is indexed by MediaStore"; return 0; }
    sleep 2
  done
  adb shell ls -l /sdcard/Music >> "$OUT/controls.txt" 2>&1
  step_fail "fixture: MediaStore never indexed $FIXTURE.wav within 60s (the app's phone import would not list it)"
}

# Import only the fixture: "Select all" is on for every audio file on the phone (system sounds included), so
# turn it off, filter the list, tick the fixture, import exactly one song.
import_fixture() {
  link "lyricflow://open/library"; sleep 3
  tap_node 'Add songs from this phone' 40 "fixture: the empty Library's import button" || return 1
  wait_node 'Select songs \([0-9]+/[0-9]+\)' 45 || { step_fail "fixture: the device audio list did not open (permission or media access)"; return 1; }
  _record "ok: fixture: the app listed the phone's audio ($(grep -o -E 'Select songs \([0-9]+/[0-9]+\)' "$OUT/ui.xml" | head -n1))"
  tap_node 'Select all' 10 "fixture: Select all" || return 1
  tap_node 'Search songs.*' 10 "fixture: the list search box" || return 1
  sleep 1; adb shell input text luvlyrics; sleep 2
  tap_node "$FIXTURE" 20 "fixture: the $FIXTURE row" || return 1
  wait_node 'Select songs \(1/[0-9]+\)' 10 || { step_fail "fixture: exactly one song was not selected"; return 1; }
  tap_node 'Import 1' 10 "fixture: the Import 1 button" || return 1
  wait_node 'Import complete' 30 || { step_fail "fixture: no 'Import complete' after importing"; return 1; }
  tap_node 'OK' 5 "fixture: dismissing the import alert" || return 1
  _record "ok: fixture: imported into the library"
}

load_fixture_track() {
  seed_fixture || return 1
  import_fixture || return 1
  link "lyricflow://open/library"
  tap_node "${FIXTURE}[^\"]*" 30 "fixture: the song row in Library" || return 1
  TRACK=fixture
}

load_live_track() {
  _record "INFO: flow: trying a live track (lyricflow://play?q=...): needs YouTube Music and the catalog to answer from this network"
  link "lyricflow://play?q=Blinding%20Lights%20The%20Weeknd"
  TRACK=live
}

# --- player state ------------------------------------------------------------------------------
# wait_state SECONDS: 0 = Now Playing open, 1 = the mini-player is showing, 2 = neither in time.
wait_state() {
  local end=$((SECONDS + $1))
  while [ "$SECONDS" -lt "$end" ]; do
    if ui_dump; then
      has_desc 'Up next' && return 0
      has_desc "$PILL_RE" && return 1
      dismiss_permission_dialog
    fi
    sleep 1
  done
  return 2
}

# wait_dismissed SECONDS: Now Playing is gone and the mini-player is back.
wait_dismissed() {
  local end=$((SECONDS + $1))
  while [ "$SECONDS" -lt "$end" ]; do
    if ui_dump && ! has_desc 'Up next' && has_desc "$PILL_RE"; then return 0; fi
    sleep 1
  done
  return 1
}

# The app's media session state, e.g. "PLAYING(3)" or "3": informational (player-assertions.sh's session_state
# would match the "state=P" in "PlaybackState").
media_state() {
  adb shell dumpsys media_session 2>/dev/null | grep -A 40 "package=$PKG" \
    | grep -m1 -o 'PlaybackState {state=[A-Za-z0-9_()]*' | sed 's/.*state=//'
}

run_cycle() {
  local round title
  wait_state 45; case $? in
    0) _record "INFO: flow: the song opened Now Playing by itself; closing it first"
       close_player; wait_dismissed 20 || { step_fail "flow: could not get from Now Playing back to the mini-player"; return 1; } ;;
    1) ;;
    *) step_fail "flow: after picking the $TRACK track neither the mini-player nor Now Playing appeared"; return 1 ;;
  esac
  wait_node "$PILL_RE" 20 || { step_fail "flow: the mini-player is not showing"; return 1; }
  title="$(pill_title)"
  _record "ok: flow: the mini-player shows '$title' ($TRACK track)"
  _snap "mini-player"

  for round in $(seq 1 "$ROUNDS"); do
    tap_bounds "$NODE"
    if wait_node 'Up next' 20; then
      _record "ok: flow round $round: tapping the mini-player opened Now Playing"
      assert_controls "flow round $round: Now Playing transport"
      _snap "now-playing-$round"
    else
      step_fail "flow round $round: tapping the mini-player did not open Now Playing"; return 1
    fi

    close_player
    if wait_dismissed 20; then
      _record "ok: flow round $round: ${CLOSED_BY:-the dismiss} returned to the mini-player ('$(pill_title)')"
      _snap "dismissed-$round"
    else
      step_fail "flow round $round: Now Playing did not dismiss back to the mini-player (tried ${CLOSED_BY:-?})"; return 1
    fi
    wait_node "$PILL_RE" 10 || return 1
  done
  _record "INFO: flow: media session playback state: $(media_state)"
}

# --- run ---------------------------------------------------------------------------------------
step "reset: empty library, no saved queue, media access granted"
adb shell input keyevent KEYCODE_WAKEUP
adb shell pm clear "$PKG" >/dev/null 2>&1
for p in READ_MEDIA_AUDIO READ_MEDIA_IMAGES READ_MEDIA_VIDEO POST_NOTIFICATIONS; do
  adb shell pm grant "$PKG" "android.permission.$p" >/dev/null 2>&1 || true
done
adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 20
link "lyricflow://diagnose"; sleep 1
# A still background so uiautomator can read the screen (the shader never stops moving otherwise).
link "lyricflow://style?canvas=0&appBackground=glass"; sleep 2
_snap "00-start"

TRACK=""
step "1. get a track into the player"
if ! load_fixture_track; then
  _record "INFO: flow: the deterministic fixture path failed (above); falling back to a live track for more evidence"
  adb shell am force-stop "$PKG"; adb shell am start -W -n "$PKG/.MainActivity" >/dev/null 2>&1; sleep 15
  load_live_track
fi

step "2. mini-player -> Now Playing -> dismiss ($ROUNDS rounds)"
if ! run_cycle; then
  _record "GAP: flow: the mini-player -> Now Playing -> dismiss cycle was NOT completed (track source: ${TRACK:-none}). See the FAIL lines and fail-*.png/xml."
fi
[ "$TRACK" = live ] && _record "GAP: flow: this cycle used a LIVE track, so it depends on third-party providers and is not deterministic"
[ "$TRACK" = fixture ] && _record "GAP: flow: playback was a generated local WAV; streaming from the catalog providers was not exercised by this deterministic flow"

step "done: $PLAYER_FAILS failed checks"
adb logcat -d -v time > "$OUT/logcat-flow.txt" 2>/dev/null
[ "$PLAYER_FAILS" -eq 0 ]
