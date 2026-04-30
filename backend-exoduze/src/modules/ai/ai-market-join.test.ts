import assert from "node:assert/strict";
import test from "node:test";

import { AiMarketJoinService } from "./ai-market-join.service.js";

const PROVIDED_SIG = "11111111111111111111111111111111";
const POSITION_SIG = "33333333333333333333333333333333";
const COMMITMENT_SIG = "44444444444444444444444444444444";
const POSITION_REF = "position-ref";
const COMMITMENT_REF = "commitment-ref";

test("stake signature resolution keeps an explicit wallet signature", async () => {
  let lookupCount = 0;

  const resolved = await (AiMarketJoinService.prototype as any).resolveStakeTransactionSignature.call(
    {
      onchainService: {},
      findSuccessfulSignatureForAddress: async () => {
        lookupCount += 1;
        return null;
      }
    },
    {
      txSig: PROVIDED_SIG,
      onchainCommitmentRef: COMMITMENT_REF,
      onchainPositionRef: POSITION_REF,
      requireCommitmentAccount: true
    }
  );

  assert.equal(resolved, PROVIDED_SIG);
  assert.equal(lookupCount, 0);
});

test("stake signature resolution falls back to the position account history first", async () => {
  const lookups: string[] = [];

  const resolved = await (AiMarketJoinService.prototype as any).resolveStakeTransactionSignature.call(
    {
      onchainService: {},
      findSuccessfulSignatureForAddress: async (address: string) => {
        lookups.push(address);
        return address === POSITION_REF ? POSITION_SIG : COMMITMENT_SIG;
      }
    },
    {
      txSig: null,
      onchainCommitmentRef: COMMITMENT_REF,
      onchainPositionRef: POSITION_REF,
      requireCommitmentAccount: true
    }
  );

  assert.equal(resolved, POSITION_SIG);
  assert.deepEqual(lookups, [POSITION_REF, COMMITMENT_REF]);
});

test("stake signature resolution falls back to the commitment account when needed", async () => {
  const resolved = await (AiMarketJoinService.prototype as any).resolveStakeTransactionSignature.call(
    {
      onchainService: {},
      findSuccessfulSignatureForAddress: async (address: string) =>
        address === POSITION_REF ? null : COMMITMENT_SIG
    },
    {
      txSig: null,
      onchainCommitmentRef: COMMITMENT_REF,
      onchainPositionRef: POSITION_REF,
      requireCommitmentAccount: true
    }
  );

  assert.equal(resolved, COMMITMENT_SIG);
});

test("stake sync records the cumulative on-chain position amount", async () => {
  const result = await (AiMarketJoinService.prototype as any).assertStakeSyncReady.call(
    {
      onchainService: {},
      formatStakeBaseUnits: (AiMarketJoinService.prototype as any).formatStakeBaseUnits,
      getVerifiedOnchainPosition: async () => ({
        agent_commitment: COMMITMENT_REF,
        claimed_amount_base_units: "0",
        market: "market-ref",
        side: "YES",
        stake_amount_base_units: "15000000",
        status: "OPEN",
        user: "wallet-ref"
      })
    },
    {
      actorWalletAddress: "wallet-ref",
      expectedDecisionSide: "YES",
      marketOnchainPubkey: "market-ref",
      onchainCommitmentRef: COMMITMENT_REF,
      onchainPositionRef: POSITION_REF,
      requireCommitmentAccount: true,
      submittedStakeAmountBaseUnits: "5000000",
      submittedStakeUsdc: "5",
      txSig: PROVIDED_SIG
    }
  );

  assert.deepEqual(result, {
    stakeAmountBaseUnits: "15000000",
    stakeUsdc: "15"
  });
});
