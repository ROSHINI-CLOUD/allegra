#!/usr/bin/env bash
# Pins the toolchain the repo's own CI uses (mobile-apk.yml: Node 20, Temurin 17) and adds swap so
# the Gradle JVM, R8 and the C++ compilers fit in a 7.5 GB `medium` machine.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

NODE_VERSION="v20.20.2"   # newest Node 20 LTS in nodejs.org/dist/index.json on 2026-11-15
NODE_DIST="node-${NODE_VERSION}-linux-x64"

# ---- swap -------------------------------------------------------------------------------------
if ! swapon --show=NAME --noheadings | grep -q .; then
  if sudo fallocate -l 8G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile; then
    log "8 GB swap enabled"
  else
    log "WARNING: swap unavailable; a heavy R8 step may be OOM-killed on a medium machine"
  fi
fi

# ---- JDK 17 -----------------------------------------------------------------------------------
java_major() { java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -n1; }
if [ "$(java_major || true)" != "17" ]; then
  JDK="$(ls -d /usr/lib/jvm/*17*amd64 2>/dev/null | head -n1 || true)"
  if [ -z "$JDK" ]; then
    log "No JDK 17 on the image; installing openjdk-17"
    sudo apt-get update -qq
    sudo apt-get install -y -qq openjdk-17-jdk-headless
    JDK=/usr/lib/jvm/java-17-openjdk-amd64
  fi
else
  JDK="$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")"
fi
[ -x "$JDK/bin/java" ] || die "JDK 17 not found at $JDK"
persist_env JAVA_HOME "$JDK"
persist_env PATH "$JDK/bin:$PATH"
export JAVA_HOME="$JDK" PATH="$JDK/bin:$PATH"

# ---- Node (pinned tarball, checksum verified) --------------------------------------------------
if [ ! -x "$HOME/node/bin/node" ] || [ "$("$HOME/node/bin/node" -v)" != "$NODE_VERSION" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${NODE_DIST}.tar.xz" -o "$tmp/node.tar.xz"
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  want="$(grep " ${NODE_DIST}.tar.xz\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)"
  got="$(sha256sum "$tmp/node.tar.xz" | cut -d' ' -f1)"
  [ -n "$want" ] && [ "$want" = "$got" ] || die "Node checksum mismatch (want '$want', got '$got')"
  rm -rf "$HOME/node"; mkdir -p "$HOME/node"
  tar -xJf "$tmp/node.tar.xz" -C "$HOME/node" --strip-components=1
  rm -rf "$tmp"
fi
persist_env PATH "$HOME/node/bin:$PATH"
export PATH="$HOME/node/bin:$PATH"

{
  echo "== toolchain ($(date -u +%FT%TZ))"
  echo "image tag     : android:2026.10.1 (pinned in .circleci/config.yml)"
  echo "kernel        : $(uname -srm)"
  echo "cpus / memory : $(nproc) vCPU / $(free -m | awk '/Mem:/ {print $2}') MB, swap $(free -m | awk '/Swap:/ {print $2}') MB"
  echo "disk free     : $(df -h / | awk 'NR==2 {print $4}')"
  echo "java          : $(java -version 2>&1 | head -n1)  JAVA_HOME=$JAVA_HOME"
  echo "node / npm    : $(node -v) / $(npm -v)"
  echo "sdk root      : $(sdk_root || echo MISSING)"
} | tee "$OUT_DIR/toolchain.txt"
