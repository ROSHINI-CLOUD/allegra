#!/usr/bin/env bash
# Builds ONE universal preview APK and proves what is in it.
#
#   variant   : release  (R8 on, JS bundled as Hermes bytecode, no Metro needed). The repo has no separate
#               "preview" Gradle variant; eas.json's "preview" profile is an EAS cloud profile and is not used.
#   ABIs      : arm64-v8a (phones) + x86_64 (the emulator) in the same file
#   signing   : the public Expo debug key (install-signing-key.sh), never a production key
#   same build as mobile-apk.yml's, except -PreactNativeArchitectures and the memory settings for a 7.5 GB machine
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

PKG_EXPECTED="com.lyricflow.app"
SDK="${ANDROID_HOME:-$(sdk_root)}"
: "${PREVIEW_CERT_SHA256:?run install-signing-key.sh first}"

VERSION="$(node -p "require('$MOBILE_DIR/app.json').expo.version")"
SHA="${CIRCLE_SHA1:-$(git -C "$REPO_ROOT" rev-parse HEAD)}"
APK="$ARTIFACT_DIR/LuvLyrics-preview-${VERSION}-${SHA:0:7}-universal.apk"
REPORT="$OUT_DIR/build-report.txt"
: > "$REPORT"
say() { echo "$*" | tee -a "$REPORT"; }

# --- build -------------------------------------------------------------------------------------
cd "$MOBILE_DIR/android"
chmod +x gradlew   # committed without the executable bit

# A preview must never pick up a production signer, whatever the project's environment holds.
unset ANDROID_RELEASE_KEYSTORE_PATH ANDROID_RELEASE_STORE_PASSWORD ANDROID_RELEASE_KEY_ALIAS \
      ANDROID_RELEASE_KEY_PASSWORD ANDROID_RELEASE_REQUIRED EXPO_PUBLIC_SENTRY_DSN SENTRY_AUTH_TOKEN
export SENTRY_DISABLE_AUTO_UPLOAD=true          # same as mobile-apk.yml: no source-map upload
export EXPO_PUBLIC_BUILD_COMMIT="$SHA"
EXPO_PUBLIC_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; export EXPO_PUBLIC_BUILD_TIME

log "building $VERSION @ ${SHA:0:7} (universal, release, ${CIRCLE_JOB:-local})"
# 5 GB heap + 1 GB metaspace leaves ~1.5 GB for the C++ compilers on a 7.5 GB machine (swap is the safety net).
# Kotlin compiles in the Gradle JVM instead of a second daemon. Two workers: the machine has two vCPUs.
set +e
timed gradle-assembleRelease timeout 90m ./gradlew assembleRelease --no-daemon --console=plain \
  -PreactNativeArchitectures=arm64-v8a,x86_64 \
  -Pkotlin.compiler.execution.strategy=in-process \
  -Dorg.gradle.workers.max=2 \
  "-Dorg.gradle.jvmargs=-Xmx5g -XX:MaxMetaspaceSize=1g"   # no heap dump: an OOM .hprof is GBs of billable artifact storage
RC=$?
set -e
if [ "$RC" -ne 0 ]; then
  [ "$RC" -eq 124 ] && say "FAIL: Gradle hit the 90 minute ceiling (900 credits on medium). Try android-resource-class=large."
  [ "$RC" -eq 137 ] && say "FAIL: Gradle was killed (exit 137): out of memory on this machine. Re-run with android-resource-class=large."
  die "assembleRelease failed with exit $RC"
fi

SRC="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"
[ -f "$SRC" ] || die "Gradle succeeded but $SRC is missing"
cp "$SRC" "$APK"

# --- verify ------------------------------------------------------------------------------------
BT_DIR="$(ls -d "$SDK"/build-tools/* | sort -V | tail -n1)"
APKSIGNER="$BT_DIR/apksigner"; AAPT2="$BT_DIR/aapt2"

say "== preview APK"
say "file          : $(basename "$APK")"
say "size          : $(du -h "$APK" | cut -f1) ($(stat -c %s "$APK") bytes)"
say "sha256        : $(sha256sum "$APK" | cut -d' ' -f1)"
say "commit        : $SHA"

# 1. signature = the public debug key, and nothing else (repo policy script, same as mobile-apk.yml)
node "$REPO_ROOT/scripts/mobile-signing-policy.mjs" --apk "$PREVIEW_CERT_SHA256" "$APKSIGNER" "$APK" | tee -a "$REPORT"
say "signing       : public Expo debug key, SHA-256 $PREVIEW_CERT_SHA256 (CI-only, not a release identity)"

# 2. identity, version, debuggable flag
BADGING="$("$AAPT2" dump badging "$APK")"
echo "$BADGING" > "$OUT_DIR/badging.txt"
PKG="$(sed -n "s/^package: name='\\([^']*\\)'.*/\\1/p" <<<"$BADGING")"
VNAME="$(sed -n "s/.*versionName='\\([^']*\\)'.*/\\1/p" <<<"$BADGING" | head -n1)"
VCODE="$(sed -n "s/.*versionCode='\\([^']*\\)'.*/\\1/p" <<<"$BADGING" | head -n1)"
[ "$PKG" = "$PKG_EXPECTED" ] || die "package is '$PKG', expected '$PKG_EXPECTED'"
grep -q "application-debuggable" <<<"$BADGING" && die "APK is debuggable: this is not the release variant"
say "package       : $PKG  versionName $VNAME  versionCode $VCODE  (not debuggable)"
say "sdk           : $(grep -E "^(sdkVersion|minSdkVersion|targetSdkVersion)" <<<"$BADGING" | tr '\n' ' ')"
say "native-code   : $(sed -n "s/^native-code: //p" <<<"$BADGING")"

# 3. both ABIs present, nothing else, and the same native libraries in each
LIBS="$OUT_DIR/apk-libs.txt"
unzip -Z1 "$APK" | grep -E '^lib/[^/]+/[^/]+\.so$' | sort > "$LIBS"
ARM="$(grep -c '^lib/arm64-v8a/' "$LIBS" || true)"; X86="$(grep -c '^lib/x86_64/' "$LIBS" || true)"
OTHER="$(grep -v -E '^lib/(arm64-v8a|x86_64)/' "$LIBS" || true)"
[ "$ARM" -gt 0 ] || die "no arm64-v8a libraries in the APK"
[ "$X86" -gt 0 ] || die "no x86_64 libraries in the APK"
[ -z "$OTHER" ] || die "unexpected ABIs in the APK: $(echo "$OTHER" | head -n3)"
say "ABIs          : arm64-v8a $ARM libs, x86_64 $X86 libs"
DIFF="$(diff <(grep '^lib/arm64-v8a/' "$LIBS" | sed 's#.*/##') <(grep '^lib/x86_64/' "$LIBS" | sed 's#.*/##') || true)"
if [ -n "$DIFF" ]; then
  say "ABI parity    : library names differ. Expected for llama.rn, which builds extra arm64 CPU-feature variants (v8, v8.2, dotprod, i8mm) and one x86_64 build. Anything else in this list deserves a look:"
  echo "$DIFF" | tee -a "$REPORT"
else say "ABI parity    : the same $ARM library names in both ABIs"; fi

# 4. the JS bundle is inside: it launches without Metro
unzip -Z1 "$APK" | grep -qx 'assets/index.android.bundle' || die "no embedded JS bundle (assets/index.android.bundle): the app would need Metro"
say "JS bundle     : assets/index.android.bundle embedded ($(unzip -l "$APK" assets/index.android.bundle | awk 'END{print $1}') bytes)"

say "build time    : $((SECONDS))s for this step (details in timings.txt)"
ls -la "$ARTIFACT_DIR"
