import assert from "node:assert/strict";
import test from "node:test";

import type { Env } from "../../config/env.js";
import { HttpError } from "../../lib/http-error.js";
import type {
  OnchainPositionAccount,
  OnchainTransactionSummary,
} from "../onchain/exoduze-onchain.service.js";
import { PortfolioService } from "./portfolio.service.js";

const PROGRAM_ID = "exoduze-program";
const MARKET_ACCOUNT = "market-account";
const POSITION_ACCOUNT = "position-account";
const USER_WALLET = "user-wallet";
const OTHER_WALLET = "other-wallet";

test("claim verification rejects a random successful transaction signature", async () => {
  await assertRejectsCode(
    () =>
      verifyClaim({
        transaction: {
          account_keys: [USER_WALLET],
          program_ids: ["other-program"],
          signer_keys: [USER_WALLET],
        },
      }),
    "ONCHAIN_TX_PROGRAM_MISMATCH",
  );
});

test("claim verification rejects the wrong program id", async () => {
  await assertRejectsCode(
    () =>
      verifyClaim({
        transaction: {
          account_keys: [USER_WALLET, MARKET_ACCOUNT, POSITION_ACCOUNT],
          program_ids: ["other-program"],
          signer_keys: [USER_WALLET],
        },
      }),
    "ONCHAIN_TX_PROGRAM_MISMATCH",
  );
});

test("claim verification rejects the wrong wallet", async () => {
  await assertRejectsCode(
    () =>
      verifyClaim({
        transaction: {
          account_keys: [OTHER_WALLET, MARKET_ACCOUNT, POSITION_ACCOUNT],
          program_ids: [PROGRAM_ID],
          signer_keys: [OTHER_WALLET],
        },
      }),
    "ONCHAIN_TX_WALLET_MISMATCH",
  );
});

test("claim verification rejects the wrong market", async () => {
  await assertRejectsCode(
    () =>
      verifyClaim({
        transaction: {
          account_keys: [USER_WALLET, "wrong-market", POSITION_ACCOUNT],
          program_ids: [PROGRAM_ID],
          signer_keys: [USER_WALLET],
        },
      }),
    "ONCHAIN_TX_MARKET_MISMATCH",
  );
});

test("claim verification rejects the wrong position", async () => {
  await assertRejectsCode(
    () =>
      verifyClaim({
        transaction: {
          account_keys: [USER_WALLET, MARKET_ACCOUNT, "wrong-position"],
          program_ids: [PROGRAM_ID],
          signer_keys: [USER_WALLET],
        },
      }),
    "ONCHAIN_TX_POSITION_MISMATCH",
  );
});

test("claim verification accepts a valid claim transaction and claimed position", async () => {
  const result = await verifyClaim({});

  assert.equal(result, "paid");
});

async function assertRejectsCode(
  action: () => Promise<unknown>,
  code: string,
) {
  await assert.rejects(action, (error) => {
    assert.equal(error instanceof HttpError, true);
    assert.equal((error as HttpError).code, code);
    return true;
  });
}

async function verifyClaim(input: {
  transaction?: OnchainTransactionSummary | null;
  position?: OnchainPositionAccount | null;
}) {
  const service = Object.create(PortfolioService.prototype) as PortfolioService;
  Object.assign(service, {
    env: {
      EXODUZE_PROGRAM_ID: PROGRAM_ID,
    } as Env,
    onchainService: {
      getTransactionSummary: async () =>
        input.transaction ??
        ({
          account_keys: [USER_WALLET, MARKET_ACCOUNT, POSITION_ACCOUNT],
          program_ids: [PROGRAM_ID],
          signer_keys: [USER_WALLET],
        } satisfies OnchainTransactionSummary),
      getPosition: async () =>
        input.position ??
        ({
          agent_commitment: "agent-commitment",
          claimed_amount_base_units: "12500000",
          market: MARKET_ACCOUNT,
          side: "YES",
          stake_amount_base_units: "5000000",
          status: "CLAIMED",
          user: USER_WALLET,
        } satisfies OnchainPositionAccount),
    },
  });

  const verify = (
    service as unknown as {
      requireConfirmedOnchainPayoutClaim: (
        walletAddress: string,
        payout: unknown,
        txSig: string,
      ) => Promise<"paid">;
    }
  ).requireConfirmedOnchainPayoutClaim;

  return verify.call(
    service,
    USER_WALLET,
    {
      id: "payout-1",
      gross_usdc: "12.500000",
      fee_usdc: "0",
      net_usdc: "12.500000",
      status: "claimable",
      market_id: "market-1",
      market_onchain_pubkey: MARKET_ACCOUNT,
      onchain_position_ref: POSITION_ACCOUNT,
    },
    "tx-sig",
  );
}
