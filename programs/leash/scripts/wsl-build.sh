#!/usr/bin/env bash
# Builds and tests the Leash program with the Solana toolchain (WSL on Windows, or any Linux/macOS).
#
# On Windows the repository lives on a /mnt/<drive> path, where cargo is slow. The sources are
# mirrored to the Linux filesystem, built there, and the outputs other workstreams consume are
# copied back into the repository:
#   target/deploy/leash.so             -> artifacts/programs/leash.so
#   packages/contracts/idl/leash.json  (regenerated with the `idl` example, as CI checks it)
#   Cargo.lock
#
# The program keypair is read from .keys/leash-program.json (gitignored) and is never copied back.
#
# Usage: bash programs/leash/scripts/wsl-build.sh [sync|build|test|check]
#   sync   mirror the sources only
#   build  anchor build and the IDL, then copy the outputs back
#   test   build, then cargo test
#   check  what CI runs: cargo fmt --check, clippy -D warnings, cargo test, the IDL drift check
set -euo pipefail

REPO="${LEASH_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
BUILD_DIR="${LEASH_BUILD_DIR:-$HOME/leash-build}"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"

sync_sources() {
  mkdir -p "$BUILD_DIR"
  # Compare by content, and give changed files a fresh mtime (no -t): cargo rebuilds from mtimes,
  # and a Windows drive seen from WSL can report stale contents right after a write.
  rsync -rlpD --checksum --delete \
    --exclude target --exclude node_modules --exclude .git --exclude .next --exclude .turbo \
    --exclude coverage --exclude .anchor --exclude test-ledger --exclude /data \
    "$REPO/" "$BUILD_DIR/"
  if [ ! -f "$REPO/.keys/leash-program.json" ]; then
    echo "error: $REPO/.keys/leash-program.json is missing (the program keypair)" >&2
    exit 1
  fi
  mkdir -p "$BUILD_DIR/target/deploy"
  cp "$REPO/.keys/leash-program.json" "$BUILD_DIR/target/deploy/leash-keypair.json"
}

build() {
  (cd "$BUILD_DIR" && anchor build && cargo run --quiet -p leash --example idl -- --write)
  mkdir -p "$REPO/artifacts/programs"
  cp "$BUILD_DIR/target/deploy/leash.so" "$REPO/artifacts/programs/leash.so"
  cp "$BUILD_DIR/packages/contracts/idl/leash.json" "$REPO/packages/contracts/idl/leash.json"
  cp "$BUILD_DIR/Cargo.lock" "$REPO/Cargo.lock"
  echo "copied back: artifacts/programs/leash.so, packages/contracts/idl/leash.json, Cargo.lock"
  sha256sum "$REPO/artifacts/programs/leash.so"
}

run_tests() {
  (cd "$BUILD_DIR" && cargo test)
}

case "${1:-build}" in
  sync)
    sync_sources
    ;;
  build)
    sync_sources
    build
    ;;
  test)
    sync_sources
    build
    run_tests
    ;;
  check)
    sync_sources
    (cd "$BUILD_DIR" &&
      cargo fmt --all -- --check &&
      cargo clippy --all-targets -- -D warnings &&
      cargo test &&
      cargo run --quiet -p leash --example idl -- --check)
    ;;
  *)
    echo "usage: $0 [sync|build|test|check]" >&2
    exit 2
    ;;
esac
