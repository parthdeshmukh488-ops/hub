#!/usr/bin/env bash
# Produces artifacts/programs/subscriptions.so: the Solana Foundation Subscriptions program that
# Leash calls (ADR-0001), for the LiteSVM tests and the localnet script. Both load it at its
# canonical address.
#
# Usage: bash scripts/subscriptions-artifact.sh [build|dump]
#   build  (default) build the audited tag from source with cargo build-sbf
#   dump   download the program deployed on devnet with `solana program dump`
#
# Either way the sha256 and the provenance go into artifacts/programs/CHECKSUMS, replacing the
# previous subscriptions.so entry. Needs the Solana toolchain (Agave CLI, cargo build-sbf).
#
# Environment:
#   SUBSCRIPTIONS_SRC   checkout to build in (default: ~/.cache/leash/subscriptions; cloned if missing)
#   SUBSCRIPTIONS_TAG   tag to build (default: program-v0.5.0, the audited line Leash targets)
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

MODE="${1:-build}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO/artifacts/programs"
OUT="$OUT_DIR/subscriptions.so"
CHECKSUMS="$OUT_DIR/CHECKSUMS"
PROGRAM_ID="De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44"
UPSTREAM="https://github.com/solana-foundation/subscriptions.git"
TAG="${SUBSCRIPTIONS_TAG:-program-v0.5.0}"
SRC="${SUBSCRIPTIONS_SRC:-$HOME/.cache/leash/subscriptions}"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

mkdir -p "$OUT_DIR"
TODAY="$(date -u +%Y-%m-%d)"
AGAVE="$(solana --version | awk '{print $2}')"

case "$MODE" in
  build)
    if [ ! -d "$SRC/.git" ]; then
      mkdir -p "$(dirname "$SRC")"
      git clone --quiet "$UPSTREAM" "$SRC"
    fi
    git -C "$SRC" fetch --quiet --tags
    git -C "$SRC" checkout --quiet "$TAG"
    COMMIT="$(git -C "$SRC" rev-parse HEAD)"
    (cd "$SRC/program" && cargo build-sbf)
    cp "$SRC/target/deploy/subscriptions_program.so" "$OUT"
    BUILD_SBF="$(cargo build-sbf --version | paste -sd ' ' -)"
    PROVENANCE="#   Source: $UPSTREAM tag $TAG (commit $COMMIT), \`cargo build-sbf\` in program/.
#   Built $TODAY with Agave $AGAVE ($BUILD_SBF)."
    ;;
  dump)
    solana program dump --url devnet "$PROGRAM_ID" "$OUT"
    SLOT="$(solana program show --url devnet "$PROGRAM_ID" | awk -F': *' '/Last Deployed In Slot/ {print $2}')"
    PROVENANCE="#   Source: \`solana program dump\` of $PROGRAM_ID on devnet (last deployed in slot $SLOT),
#   dumped $TODAY with Agave $AGAVE."
    ;;
  *)
    echo "usage: $0 [build|dump]   (--help for details)" >&2
    exit 2
    ;;
esac

SHA="$(sha256sum "$OUT" | cut -d' ' -f1)"

# Replace the previous subscriptions.so entry (its comment block and hash line), keep the rest.
touch "$CHECKSUMS"
awk '
  /^# subscriptions\.so / { skipping = 1 }
  skipping && /  subscriptions\.so$/ { skipping = 0; next }
  !skipping { print }
' "$CHECKSUMS" > "$CHECKSUMS.tmp"
{
  cat "$CHECKSUMS.tmp"
  echo "# subscriptions.so (WS0): the Solana Foundation Subscriptions program, loaded at $PROGRAM_ID."
  echo "$PROVENANCE"
  echo "$SHA  subscriptions.so"
} > "$CHECKSUMS"
rm "$CHECKSUMS.tmp"

echo "wrote $OUT ($(wc -c < "$OUT") bytes)"
echo "sha256 $SHA"
(cd "$OUT_DIR" && sha256sum -c CHECKSUMS)
