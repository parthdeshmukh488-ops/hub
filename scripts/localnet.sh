#!/usr/bin/env bash
# Starts a local Solana chain for Leash (WS0 step 4):
#   - solana-test-validator with the Leash and Subscriptions programs from artifacts/programs,
#   - a mock USDC mint (6 decimals) at a stable address, minted by owner-demo,
#   - SOL for every demo key, 1,000 USDC for owner-demo, and USDC accounts for merchant and attacker,
#   - .localnet.json at the repo root with every address (read it instead of hard-coding them).
#
# Usage: bash scripts/localnet.sh
#   Runs in the foreground; Ctrl+C stops the chain. It starts empty every time (--reset).
#   RPC http://127.0.0.1:8899, WebSocket ws://127.0.0.1:8900 (WSL forwards both to Windows).
#   On Windows, run it inside WSL, where the Solana toolchain lives:
#     wsl.exe -e bash -lc 'cd "/mnt/f/lasona h/hub-repo" && bash scripts/localnet.sh'
#
# Needs the demo keys (`pnpm keys`) and artifacts/programs/{leash,subscriptions}.so.
# Environment: LEASH_LEDGER_DIR (default ~/.cache/leash/test-ledger).
set -euo pipefail

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

# Work from the repo root with relative paths: the Solana CLIs reject keypair paths that contain
# a space (e.g. "/mnt/f/lasona h/...") as an unrecognized signer source.
cd "$(dirname "${BASH_SOURCE[0]}")/.."
KEYS=".keys"
PROGRAMS="artifacts/programs"
LEDGER="${LEASH_LEDGER_DIR:-$HOME/.cache/leash/test-ledger}"
RPC="http://127.0.0.1:8899"
WS="ws://127.0.0.1:8900"
LEASH_ID="HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu"
SUBSCRIPTIONS_ID="De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44"
MINT_KEYPAIR="$KEYS/localnet-usdc-mint.json"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

fail() {
  echo "localnet: $*" >&2
  exit 1
}

for tool in solana solana-test-validator solana-keygen spl-token; do
  command -v "$tool" > /dev/null || fail "$tool not found: install the Agave CLI (docs/adr/0007)"
done
for file in leash.so subscriptions.so; do
  [ -f "$PROGRAMS/$file" ] || fail "artifacts/programs/$file is missing"
done
for name in owner-demo agent merchant attacker guardian facilitator; do
  [ -f "$KEYS/$name.json" ] || fail ".keys/$name.json is missing: run \`pnpm keys\`"
done
if curl -s -m 2 "$RPC" > /dev/null 2>&1; then
  fail "something already listens on $RPC (another validator?); stop it first"
fi
(cd "$PROGRAMS" && sha256sum --quiet -c CHECKSUMS) || fail "artifacts/programs do not match CHECKSUMS"

# The mock mint keeps its address across restarts, so .env files can name it.
if [ ! -f "$MINT_KEYPAIR" ]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile "$MINT_KEYPAIR"
fi

address() { solana-keygen pubkey "$KEYS/$1.json"; }
OWNER="$(address owner-demo)"
USDC="$(solana-keygen pubkey "$MINT_KEYPAIR")"

mkdir -p "$LEDGER"
# The default keeps 10,000 shreds, a few minutes of history: older transactions then vanish from
# getTransaction and getSignaturesForAddress, which the indexer and explorer links need. This
# keeps about a day (a few GB at most; --reset clears it at the next start).
solana-test-validator --reset --quiet --ledger "$LEDGER" --limit-ledger-size 5000000 \
  --bpf-program "$LEASH_ID" "$PROGRAMS/leash.so" \
  --bpf-program "$SUBSCRIPTIONS_ID" "$PROGRAMS/subscriptions.so" &
VALIDATOR=$!
trap 'kill "$VALIDATOR" 2> /dev/null || true' EXIT INT TERM

echo "localnet: waiting for the validator (ledger $LEDGER)"
for _ in $(seq 1 60); do
  if solana --url "$RPC" cluster-version > /dev/null 2>&1; then break; fi
  kill -0 "$VALIDATOR" 2> /dev/null || fail "the validator exited; see $LEDGER/validator.log"
  sleep 1
done
solana --url "$RPC" cluster-version > /dev/null 2>&1 || fail "the validator did not start in 60 s"

sol() { solana --url "$RPC" airdrop "$2" "$(address "$1")" > /dev/null; }
sol owner-demo 100
sol agent 10
sol guardian 10
sol facilitator 10
sol merchant 1
sol attacker 1

token() { spl-token --url "$RPC" --fee-payer "$KEYS/owner-demo.json" "$@"; }
token create-token --decimals 6 --mint-authority "$OWNER" "$MINT_KEYPAIR" > /dev/null
ata() { spl-token --url "$RPC" address --verbose --token "$USDC" --owner "$(address "$1")" |
  awk '/Associated token address/ {print $NF}'; }
for name in owner-demo merchant attacker; do
  token create-account "$USDC" --owner "$(address "$name")" > /dev/null
done
token mint "$USDC" 1000 "$(ata owner-demo)" --mint-authority "$KEYS/owner-demo.json" > /dev/null

key_lines=()
for name in owner-demo agent merchant attacker guardian facilitator; do
  key_lines+=("    \"$name\": \"$(address "$name")\"")
done
keys_json="$(printf '%s,\n' "${key_lines[@]}")"
keys_json="${keys_json%,}"
cat > .localnet.json << EOF
{
  "cluster": "localnet",
  "rpcUrl": "$RPC",
  "wsUrl": "$WS",
  "programIds": {
    "leash": "$LEASH_ID",
    "subscriptions": "$SUBSCRIPTIONS_ID"
  },
  "usdcMint": "$USDC",
  "keys": {
$keys_json
  },
  "usdcAccounts": {
    "owner-demo": "$(ata owner-demo)",
    "merchant": "$(ata merchant)",
    "attacker": "$(ata attacker)"
  },
  "startedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

cat << EOF

localnet is up at $RPC (Ctrl+C stops it).
  Leash          $LEASH_ID
  Subscriptions  $SUBSCRIPTIONS_ID
  mock USDC      $USDC (owner-demo holds 1,000)
Addresses are in .localnet.json. For .env files: LEASH_CLUSTER=localnet LEASH_USDC_MINT=$USDC
EOF
wait "$VALIDATOR"
