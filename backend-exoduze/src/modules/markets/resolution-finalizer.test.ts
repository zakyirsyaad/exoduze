import assert from "node:assert/strict";
import test from "node:test";

import type { Env } from "../../config/env.js";
import type { AppDatabase } from "../../db/database.js";
import type { ExoduzeOnchainService } from "../onchain/exoduze-onchain.service.js";
import type { MarketsService } from "./markets.service.js";
import { ResolutionFinalizerService } from "./resolution-finalizer.js";

const NOW = new Date("2026-05-01T12:00:00.000Z");

test("finalizer leaves resolution retryable when on-chain settlement fails", async () => {
  const state = buildFinalizerState();
  const db = new FakeFinalizerDb(state);
  const marketsService = new FakeMarketsService(state);
  const onchainService = new FakeOnchainService();
  onchainService.failNext = true;

  const result = await buildFinalizer(
    db,
    marketsService,
    onchainService,
  ).finalizeResolutions(NOW);

  assert.equal(result.resolutionsFinalized, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]?.message ?? "", /on-chain settlement failed/);
  assert.equal(state.resolution.status, "proposed");
  assert.equal(state.resolution.onchain_settlement_tx_sig, null);
  assert.equal(state.market.status, "resolving");
  assert.equal(onchainService.resolveCalls, 1);
  assert.equal(marketsService.finalizeCalls, 0);
});

test("finalizer leaves resolution retryable when DB settlement fails", async () => {
  const state = buildFinalizerState();
  const db = new FakeFinalizerDb(state);
  const marketsService = new FakeMarketsService(state);
  const onchainService = new FakeOnchainService();
  marketsService.failNext = true;

  const result = await buildFinalizer(
    db,
    marketsService,
    onchainService,
  ).finalizeResolutions(NOW);

  assert.equal(result.resolutionsFinalized, 0);
  assert.equal(result.skipped, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0]?.message ?? "", /DB settlement failed/);
  assert.equal(state.resolution.status, "proposed");
  assert.equal(state.resolution.finalized_outcome, null);
  assert.equal(state.resolution.onchain_settlement_tx_sig, "tx-1");
  assert.equal(state.resolution.onchain_settled_at, NOW.toISOString());
  assert.equal(state.market.status, "resolving");
  assert.equal(onchainService.resolveCalls, 1);
  assert.equal(marketsService.finalizeCalls, 1);
});

test("finalizer retries DB settlement after failure without repeating on-chain settlement", async () => {
  const state = buildFinalizerState();
  const db = new FakeFinalizerDb(state);
  const marketsService = new FakeMarketsService(state);
  const onchainService = new FakeOnchainService();
  marketsService.failNext = true;
  const finalizer = buildFinalizer(db, marketsService, onchainService);

  const first = await finalizer.finalizeResolutions(NOW);
  assert.equal(first.errors.length, 1);
  assert.equal(state.resolution.status, "proposed");

  const second = await finalizer.finalizeResolutions(NOW);

  assert.equal(second.resolutionsFinalized, 1);
  assert.equal(second.skipped, 0);
  assert.equal(second.errors.length, 0);
  assert.equal(state.resolution.status, "finalized");
  assert.equal(state.market.status, "resolved");
  assert.equal(state.resolution.finalized_outcome, "YES");
  assert.equal(onchainService.resolveCalls, 1);
  assert.equal(marketsService.finalizeCalls, 2);
  assert.equal(marketsService.inputs[1]?.submittedTxSig, "tx-1");
});

test("repeated finalizer run does not duplicate settlement", async () => {
  const state = buildFinalizerState();
  const db = new FakeFinalizerDb(state);
  const marketsService = new FakeMarketsService(state);
  const onchainService = new FakeOnchainService();
  const finalizer = buildFinalizer(db, marketsService, onchainService);

  const first = await finalizer.finalizeResolutions(NOW);
  const second = await finalizer.finalizeResolutions(NOW);

  assert.equal(first.resolutionsFinalized, 1);
  assert.equal(second.resolutionsFinalized, 0);
  assert.equal(second.skipped, 0);
  assert.equal(second.errors.length, 0);
  assert.equal(state.resolution.status, "finalized");
  assert.equal(state.market.status, "resolved");
  assert.equal(onchainService.resolveCalls, 1);
  assert.equal(marketsService.finalizeCalls, 1);
});

test("already finalized resolution is skipped safely", async () => {
  const state = buildFinalizerState();
  state.market.status = "resolved";
  state.resolution.status = "finalized";
  state.resolution.finalized_outcome = "YES";
  state.resolution.finalized_at = NOW.toISOString();
  const db = new FakeFinalizerDb(state);
  const marketsService = new FakeMarketsService(state);
  const onchainService = new FakeOnchainService();

  const result = await buildFinalizer(
    db,
    marketsService,
    onchainService,
  ).finalizeResolutions(NOW);

  assert.equal(result.resolutionsFinalized, 0);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(onchainService.resolveCalls, 0);
  assert.equal(marketsService.finalizeCalls, 0);
});

function buildFinalizer(
  db: FakeFinalizerDb,
  marketsService: FakeMarketsService,
  onchainService: FakeOnchainService,
) {
  return new ResolutionFinalizerService(
    db as unknown as AppDatabase,
    {
      ORACLE_RESOLUTION_ENABLED: true,
      AUTONOMOUS_RESOLVE_ONCHAIN: true,
    } as Env,
    marketsService as unknown as MarketsService,
    onchainService as unknown as ExoduzeOnchainService,
  );
}

type FinalizerState = ReturnType<typeof buildFinalizerState>;

function buildFinalizerState() {
  return {
    market: {
      id: "market-1",
      status: "resolving",
      oracle_source: "exoduze_topic_snapshots",
      onchain_market_pubkey: "market-pubkey",
    },
    resolution: {
      id: "resolution-1",
      market_id: "market-1",
      proposed_outcome: "YES" as const,
      evidence_snapshot_id: "snapshot-1",
      evidence_summary: "Topic ranked inside the required threshold.",
      status: "proposed",
      dispute_deadline: "2026-05-01T11:00:00.000Z",
      updated_at: "2026-05-01T11:00:00.000Z",
      finalized_outcome: null as "YES" | "NO" | null,
      finalized_at: null as string | null,
      finalized_by: null as string | null,
      onchain_settlement_tx_sig: null as string | null,
      onchain_settled_at: null as string | null,
    },
    openDispute: false,
  };
}

class FakeFinalizerDb {
  constructor(readonly state: FinalizerState) {}

  async query(text: string, params: unknown[] = []) {
    return handleFinalizerQuery(this.state, text, params);
  }

  async connect() {
    return new FakeFinalizerClient(this.state);
  }
}

class FakeFinalizerClient {
  constructor(readonly state: FinalizerState) {}

  async query(text: string, params: unknown[] = []) {
    return handleFinalizerQuery(this.state, text, params);
  }

  release() {}
}

class FakeOnchainService {
  failNext = false;
  resolveCalls = 0;
  programId = {
    toBase58: () => "program-id",
  };

  async isAccountOwnedByCurrentProgram() {
    return true;
  }

  async resolveMarket(input: { marketPubkey: string; outcome: "YES" | "NO" }) {
    this.resolveCalls += 1;
    if (this.failNext) {
      this.failNext = false;
      throw new Error("on-chain settlement failed");
    }

    return {
      already_resolved: false,
      tx_sig: `tx-${this.resolveCalls}`,
      market_pubkey: input.marketPubkey,
      outcome: input.outcome,
    };
  }
}

class FakeMarketsService {
  failNext = false;
  finalizeCalls = 0;
  inputs: Array<{
    submittedTxSig?: string | null | undefined;
  }> = [];

  constructor(readonly state: FinalizerState) {}

  async finalizeAutomaticResolution(input: {
    outcome: "YES" | "NO";
    resolvedAt: string;
    finalizedBy: string;
    submittedTxSig?: string | null | undefined;
  }) {
    this.finalizeCalls += 1;
    this.inputs.push(input);

    if (this.failNext) {
      this.failNext = false;
      throw new Error("DB settlement failed");
    }

    if (this.state.resolution.status === "finalized") {
      return { finalized: false, settlement: null };
    }

    this.state.market.status = "resolved";
    this.state.resolution.status = "finalized";
    this.state.resolution.finalized_outcome = input.outcome;
    this.state.resolution.finalized_at = input.resolvedAt;
    this.state.resolution.finalized_by = input.finalizedBy;

    return {
      finalized: true,
      settlement: {
        submitted_tx_sig: input.submittedTxSig ?? null,
      },
    };
  }
}

async function handleFinalizerQuery(
  state: FinalizerState,
  text: string,
  params: unknown[],
) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
    return queryResult([]);
  }

  if (normalized.startsWith("INSERT INTO audit_logs")) {
    return queryResult([], 1);
  }

  if (normalized.includes("FROM market_resolutions mr JOIN markets m")) {
    const now = String(params[0]);
    const retryBefore = String(params[1]);
    const dueProposal =
      state.resolution.status === "proposed" &&
      state.resolution.dispute_deadline <= now;
    const staleSettling =
      state.resolution.status === "settling" &&
      state.resolution.updated_at <= retryBefore;

    if (
      ["resolved", "disputed", "cancelled"].includes(state.market.status) ||
      (!dueProposal && !staleSettling)
    ) {
      return queryResult([]);
    }

    return queryResult([buildCandidateRow(state)]);
  }

  if (normalized.startsWith("SELECT status FROM markets")) {
    return queryResult(
      state.market.id === params[0] ? [{ status: state.market.status }] : [],
    );
  }

  if (
    normalized.includes("FROM market_resolutions") &&
    normalized.includes("FOR UPDATE") &&
    !normalized.includes("JOIN")
  ) {
    return queryResult(
      state.resolution.id === params[0]
        ? [
            {
              status: state.resolution.status,
              dispute_deadline: state.resolution.dispute_deadline,
              updated_at: state.resolution.updated_at,
              onchain_settlement_tx_sig:
                state.resolution.onchain_settlement_tx_sig,
              onchain_settled_at: state.resolution.onchain_settled_at,
            },
          ]
        : [],
    );
  }

  if (normalized.includes("FROM market_disputes")) {
    return queryResult(state.openDispute ? [{ id: "dispute-1" }] : []);
  }

  if (normalized.includes("SET status = 'settling'")) {
    if (
      state.resolution.id !== params[0] ||
      !["proposed", "settling"].includes(state.resolution.status)
    ) {
      return queryResult([]);
    }

    state.resolution.status = "settling";
    state.resolution.updated_at = NOW.toISOString();
    return queryResult([
      {
        onchain_settlement_tx_sig: state.resolution.onchain_settlement_tx_sig,
        onchain_settled_at: state.resolution.onchain_settled_at,
        updated_at: state.resolution.updated_at,
      },
    ]);
  }

  if (normalized.includes("onchain_settlement_tx_sig")) {
    if (state.resolution.id === params[0] && state.resolution.status === "settling") {
      state.resolution.onchain_settlement_tx_sig =
        (params[1] as string | null) ?? state.resolution.onchain_settlement_tx_sig;
      state.resolution.onchain_settled_at =
        state.resolution.onchain_settled_at ?? String(params[2]);
      state.resolution.updated_at = NOW.toISOString();
      return queryResult([], 1);
    }

    return queryResult([], 0);
  }

  if (normalized.includes("SET status = 'proposed'")) {
    if (state.resolution.id === params[0] && state.resolution.status === "settling") {
      state.resolution.status = "proposed";
      state.resolution.updated_at = NOW.toISOString();
      return queryResult([], 1);
    }

    return queryResult([], 0);
  }

  throw new Error(`Unhandled fake finalizer query: ${normalized}`);
}

function buildCandidateRow(state: FinalizerState) {
  return {
    id: state.resolution.id,
    market_id: state.resolution.market_id,
    proposed_outcome: state.resolution.proposed_outcome,
    evidence_snapshot_id: state.resolution.evidence_snapshot_id,
    evidence_summary: state.resolution.evidence_summary,
    status: state.resolution.status,
    dispute_deadline: state.resolution.dispute_deadline,
    updated_at: state.resolution.updated_at,
    market_oracle_source: state.market.oracle_source,
    market_status: state.market.status,
    onchain_market_pubkey: state.market.onchain_market_pubkey,
    onchain_settlement_tx_sig: state.resolution.onchain_settlement_tx_sig,
    onchain_settled_at: state.resolution.onchain_settled_at,
  };
}

function queryResult(rows: unknown[], rowCount = rows.length) {
  return { rows, rowCount };
}
