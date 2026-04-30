#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_PORT="${EXODUZE_TEST_RPC_PORT:-18999}"
FAUCET_PORT="${EXODUZE_TEST_FAUCET_PORT:-19001}"
RPC_URL="http://127.0.0.1:${RPC_PORT}"
LEDGER_DIR="${ROOT_DIR}/.anchor/test-ledger-${RPC_PORT}"
LOG_DIR="${ROOT_DIR}/.anchor"
LOG_FILE="${LOG_DIR}/test-validator-${RPC_PORT}.log"
WALLET_PATH="${ANCHOR_WALLET:-${HOME}/.config/solana/id.json}"
PROGRAM_SO="${ROOT_DIR}/target/deploy/exoduze_prediction_market.so"
PROGRAM_KEYPAIR="${ROOT_DIR}/keys/localnet-program-keypair.json"

mkdir -p "${LOG_DIR}"
rm -rf "${LEDGER_DIR}"

cleanup() {
  if [[ -n "${VALIDATOR_PID:-}" ]]; then
    kill "${VALIDATOR_PID}" >/dev/null 2>&1 || true
    wait "${VALIDATOR_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

solana-test-validator \
  --reset \
  --quiet \
  --ledger "${LEDGER_DIR}" \
  --rpc-port "${RPC_PORT}" \
  --faucet-port "${FAUCET_PORT}" \
  >"${LOG_FILE}" 2>&1 &
VALIDATOR_PID=$!

for _ in $(seq 1 30); do
  if solana cluster-version --url "${RPC_URL}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! solana cluster-version --url "${RPC_URL}" >/dev/null 2>&1; then
  echo "Local validator did not become ready. See ${LOG_FILE}" >&2
  exit 1
fi

WALLET_ADDRESS="$(solana address -k "${WALLET_PATH}")"
solana airdrop 100 "${WALLET_ADDRESS}" --url "${RPC_URL}" >/dev/null

export ANCHOR_PROVIDER_URL="${RPC_URL}"
export ANCHOR_WALLET="${WALLET_PATH}"
export EXODUZE_TEST_PROGRAM_ID
EXODUZE_TEST_PROGRAM_ID="$(solana address -k "${PROGRAM_KEYPAIR}")"

cd "${ROOT_DIR}"

anchor build --no-idl -- --features localnet-program-id
solana program deploy \
  "${PROGRAM_SO}" \
  --program-id "${PROGRAM_KEYPAIR}" \
  --url "${RPC_URL}" \
  --keypair "${WALLET_PATH}" \
  >/dev/null
pnpm exec mocha --timeout 1000000 tests/**/*.js
