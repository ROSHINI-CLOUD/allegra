#!/usr/bin/env bash
# CI-only signing identity, exactly what mobile-apk.yml uses for every non-main build: the public debug
# keystore from Expo's bare template. It is published on npm, so it proves nothing and protects nothing.
# The preview APK can therefore never be mistaken for, or replace, the production-signed LuvLyrics.
# No production keystore, password or secret is read here.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

KEY="$MOBILE_DIR/android/app/debug.keystore"   # gitignored; android/app/build.gradle's debug config reads it
tmp="$(mktemp -d)"
( cd "$tmp" && npm pack expo-template-bare-minimum@sdk-54 --silent >/dev/null \
    && tar -xzf expo-template-bare-minimum-*.tgz package/android/app/debug.keystore )
cp "$tmp/package/android/app/debug.keystore" "$KEY"
rm -rf "$tmp"

CERT="$(keytool -list -v -keystore "$KEY" -storepass android -alias androiddebugkey \
  | awk -F': ' '/SHA256: / { gsub(":", "", $2); print toupper($2); exit }')"
[ "${#CERT}" -eq 64 ] || die "could not read the debug key's SHA-256 (got '$CERT')"
persist_env PREVIEW_CERT_SHA256 "$CERT"
log "signing with the public Expo debug key, SHA-256 $CERT"
