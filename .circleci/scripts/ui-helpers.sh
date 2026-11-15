#!/usr/bin/env bash
# uiautomator helpers on top of .github/scripts/player-assertions.sh (source that first: it provides ui_dump,
# desc_bounds, tap_bounds, assert_controls, pill_title, _record, _snap, _slug). Source this file; do not run it.
#
# player-assertions.sh matches accessibility labels (content-desc) only. Plain RN <Text> buttons ("Import 1",
# "OK", "Add songs from this phone") expose `text=` instead, so these match either.

# node_bounds REGEX: "left top right bottom" of the first node whose text or content-desc is exactly matched by
# REGEX (extended regex, from the last ui_dump). Prints nothing if there is none.
node_bounds() {
  grep -o -E "(text|content-desc)=\"($1)\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" "$OUT/ui.xml" 2>/dev/null \
    | head -n 1 | grep -o -E 'bounds="[^"]*"' | grep -o -E '[0-9]+' | tr '\n' ' '
}

# has_desc REGEX: is there a node whose content-desc is matched by REGEX (from the last ui_dump)?
has_desc() { grep -q -E "content-desc=\"($1)\"" "$OUT/ui.xml" 2>/dev/null; }

# Android's runtime-permission dialog (media access) sits above the app and swallows taps.
dismiss_permission_dialog() {
  grep -q 'permissioncontroller' "$OUT/ui.xml" 2>/dev/null || return 0
  local b
  b="$(node_bounds 'Allow all|Allow|While using the app|Allow only while using the app|Allow limited access')"
  if [ -n "$b" ]; then tap_bounds "$b"; _record "INFO: flow: answered a system permission dialog with Allow"; sleep 1; fi
}

# wait_node REGEX SECONDS: poll the screen until a node matches. Sets NODE to its bounds. 0 = found.
wait_node() {
  local re="$1" end=$((SECONDS + $2))
  NODE=""
  while [ "$SECONDS" -lt "$end" ]; do
    if ui_dump; then
      NODE="$(node_bounds "$re")"
      [ -n "$NODE" ] && return 0
      dismiss_permission_dialog
    fi
    sleep 1
  done
  return 1
}

# step_fail MESSAGE: one FAIL line, a screenshot and the screen's tree kept beside the results.
step_fail() {
  local tag; tag="$(_slug "$1" | cut -c1-48)"
  _record "FAIL: $1"
  _snap "fail-$tag"
  [ -f "$OUT/ui.xml" ] && cp "$OUT/ui.xml" "$OUT/fail-$tag.xml"
  return 1
}

# tap_node REGEX SECONDS WHAT: wait for a node, tap its centre, or record a failure naming WHAT.
tap_node() {
  if wait_node "$1" "$2"; then tap_bounds "$NODE"; return 0; fi
  step_fail "$3: nothing matching '$1' appeared within ${2}s"
}

# close_player: the player's own close control if the screen has one, otherwise the Back key (what
# mobile-player-probe.sh uses; on Android the header can be native and carry no such label).
close_player() {
  local b=""
  ui_dump && b="$(desc_bounds 'Close player')"
  if [ -n "$b" ]; then tap_bounds "$b"; CLOSED_BY="the Close player control"
  else adb shell input keyevent KEYCODE_BACK; CLOSED_BY="the Back key"; fi
}
