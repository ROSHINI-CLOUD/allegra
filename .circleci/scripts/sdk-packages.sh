#!/usr/bin/env bash
# The CircleCI image ships platforms 29-35 and NDK 28.0.12433566. This app builds against what React Native
# 0.81 declares (platform 36, build-tools 36.0.0, NDK 27.1.12297006), so install exactly those. Versions are
# read from the installed react-native, not typed here, so they follow the lockfile.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

TOML="$MOBILE_DIR/node_modules/react-native/gradle/libs.versions.toml"
[ -f "$TOML" ] || die "$TOML missing: run npm ci first"
toml() { sed -n "s/^$1 *= *\"\\([^\"]*\\)\".*/\\1/p" "$TOML" | head -n1; }

NDK="$(toml ndkVersion)"; COMPILE="$(toml compileSdk)"; BT="$(toml buildTools)"
[ -n "$NDK" ] && [ -n "$COMPILE" ] && [ -n "$BT" ] || die "could not read ndkVersion/compileSdk/buildTools from $TOML"
log "react-native wants platform $COMPILE, build-tools $BT, NDK $NDK"
[ "$NDK" = "27.1.12297006" ] || log "WARNING: NDK is $NDK, but config.yml's Gradle cache key says 27.1.12297006. Update the key so a stale cache is not reused."

SDK="$(sdk_root)" || die "no Android SDK on this image"
persist_env ANDROID_HOME "$SDK"
persist_env ANDROID_SDK_ROOT "$SDK"

accept_licenses
timed sdk-packages sdkmanager --install "platforms;android-$COMPILE" "build-tools;$BT" "ndk;$NDK" "cmake;3.22.1" \
  > "$OUT_DIR/sdkmanager.log" 2>&1 || { tail -n 40 "$OUT_DIR/sdkmanager.log"; die "sdkmanager failed"; }

[ -d "$SDK/ndk/$NDK" ] || die "NDK $NDK not installed under $SDK/ndk"
log "installed: platform-$COMPILE, build-tools $BT, NDK $NDK ($(ls "$SDK/ndk" | tr '\n' ' '))"
