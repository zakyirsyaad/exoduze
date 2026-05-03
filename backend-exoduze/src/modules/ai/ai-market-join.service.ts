import type { PoolClient } from "pg";

import type { Env } from "../../config/env.js";
import type { AppDatabase } from "../../db/database.js";
import { queryOne, queryRows } from "../../db/query.js";
import { createStableId } from "../../lib/ids.js";
import { HttpError, isPgErrorCode } from "../../lib/http-error.js";
import type {
  AgentSpecialization,
  BattleSignalWeights,
  DataFocus,
  RiskProfile,
  StrategyPreset,
} from "./battle-config.js";
import {
  getDefaultBasePersonality,
  getDefaultBaseStrategy,
  getDefaultDataFocus,
  strategyPresetWeights,
  sumBattleWeights,
} from "./battle-config.js";
import {
  BattlePredictionService,
  type BattlePredictionJson,
} from "./battle-prediction.service.js";
import type { RequestAuth } from "../auth/auth.types.js";
import { getEffectiveMarketStatus } from "../markets/market-status.js";
import type {
  ExoduzeOnchainService,
  OnchainPositionAccount,
  OnchainSignatureStatus,
} from "../onchain/exoduze-onchain.service.js";
import { hashCanonicalJson } from "../../../ai-exoduze/index.js";

type JoinAgentInput = {
  userPrompt?: string | null | undefined;
  strategyPreset?: StrategyPreset | undefined;
  technicalWeight?: number | undefined;
  newsWeight?: number | undefined;
  sentimentWeight?: number | undefined;
  macroWeight?: number | undefined;
  onchainWeight?: number | undefined;
  optionalInsight?: string | null | undefined;
  stakeUsdc?: string | undefined;
};

type StakeConfirmationInput = {
  commitIncluded?: boolean | null | undefined;
  marketAgentId?: string | null | undefined;
  onchainCommitmentRef: string;
  onchainPositionRef: string;
  stakeAmountBaseUnits: string;
  stakeUsdc: string;
  txSig?: string | null | undefined;
  userTokenAccount?: string | null | undefined;
  vaultPubkey?: string | null | undefined;
};

type MarketContextRow = {
  id: string;
  slug: string;
  title: string;
  short_description: string;
  description: string;
  status: string;
  onchain_market_pubkey: string | null;
  oracle_source: string;
  settlement_asset: string;
  rules_json: unknown;
  opens_at: string;
  join_deadline_at: string;
  decision_cutoff_at: string;
  closes_at: string;
  resolves_at: string | null;
  category_slug: string;
  category_name: string;
};

type AgentContextRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  specialization: AgentSpecialization;
  base_personality: string | null;
  base_strategy: string | null;
  risk_profile: RiskProfile;
  data_focus: unknown;
  owner_wallet_identity_id: string | null;
  owner_wallet_address: string | null;
};

type AgentVersionRow = {
  id: string;
  version_no: number;
  version_label: string;
  model_provider: string;
  model_name: string;
  runtime_config_json: unknown;
  config_hash: string;
};

type StakeMarketAgentRow = {
  id: string;
  market_id: string;
  agent_id: string;
  agent_slug: string;
  agent_name: string;
  owner_wallet_address: string | null;
  final_decision_side: string | null;
  status: string;
  commitment_id: string | null;
  commit_tx_sig: string | null;
  onchain_commitment_ref: string | null;
  verification_status: string | null;
};

type ExistingJoinRow = {
  market_agent_id: string;
  agent_id: string;
  agent_slug: string;
  agent_name: string;
  verification_status: string | null;
  prompt_hash: string | null;
  config_hash: string | null;
  snapshot_hash: string | null;
  sequence_no: number | null;
  decision_side: string | null;
  confidence: number | null;
  reason_summary: string | null;
  key_signals: string[] | null;
  risk_factors: string[] | null;
  reason_hash: string | null;
  decided_at: string | null;
};

type DecisionRefreshCandidateRow = {
  market_id: string;
  market_slug: string;
  market_title: string;
  market_short_description: string;
  market_description: string;
  market_oracle_source: string;
  market_settlement_asset: string;
  market_rules_json: unknown;
  market_opens_at: string;
  market_join_deadline_at: string;
  market_decision_cutoff_at: string;
  market_closes_at: string;
  category_slug: string;
  market_agent_id: string;
  agent_id: string;
  agent_slug: string;
  agent_name: string;
  agent_description: string;
  agent_specialization: AgentSpecialization;
  agent_base_personality: string | null;
  agent_base_strategy: string | null;
  agent_risk_profile: RiskProfile;
  agent_data_focus: unknown;
  strategy_preset: StrategyPreset;
  technical_weight: number;
  news_weight: number;
  sentiment_weight: number;
  macro_weight: number;
  onchain_weight: number;
  optional_insight: string | null;
  stake_amount: string;
  latest_sequence_no: number | null;
  latest_decision_side: string | null;
  latest_confidence: number | null;
  latest_decided_at: string | null;
};

type DecisionRefreshNewsContextItem = {
  title: string;
  summary: string | null;
  url: string;
  sourceName: string;
  publishedAt: string;
  isBreaking: boolean;
};

type MonitoringAggregateRow = {
  total_agents_count: number;
  yes_agents_count: number;
  no_agents_count: number;
  yes_staked_usdc: string;
  no_staked_usdc: string;
  total_staked_usdc: string;
};

type ResolvedBattleStrategy = BattleSignalWeights & {
  preset: StrategyPreset;
  optionalInsight: string | null;
  stakeUsdc: string;
};

export type RefreshAiDecisionsResult = {
  decisionsRefreshed: number;
  skipped: number;
  errors: Array<{
    marketId: string;
    marketAgentId: string;
    message: string;
  }>;
};

const STAKE_BASE_UNIT_DECIMALS = 6n;
const STAKE_BASE_UNIT_SCALE = 10n ** STAKE_BASE_UNIT_DECIMALS;

export class AiMarketJoinService {
  private readonly battlePredictionService: BattlePredictionService;

  constructor(
    private readonly db: AppDatabase,
    private readonly env: Env,
    private readonly onchainService?: ExoduzeOnchainService,
  ) {
    this.battlePredictionService = new BattlePredictionService(env);
  }

  async joinAndDecide(
    actor: RequestAuth,
    marketIdOrSlug: string,
    agentIdOrSlug: string,
    input: JoinAgentInput = {},
  ) {
    const market = await this.requireMarketContext(marketIdOrSlug);
    const effectiveMarketStatus = getEffectiveMarketStatus(market);
    const marketContext = { ...market, status: effectiveMarketStatus };
    this.assertMarketJoinable(marketContext);

    const agent = await this.requireAgentContext(agentIdOrSlug);
    this.assertCanUseAgent(actor, agent);

    const existingJoin = await this.getRetryableExistingJoinResult(
      marketContext,
      agent,
    );
    if (existingJoin) {
      return existingJoin;
    }

    await this.assertOwnerJoinSlotAvailable(marketContext.id, agent);
    const latestVersion = await this.ensureLatestAgentVersion(agent);
    const strategy = this.resolveBattleStrategyInput(input);
    const aiDecision = await this.battlePredictionService.generatePrediction({
      agent: {
        id: agent.id,
        name: agent.name,
        specialization: agent.specialization,
        description: agent.description,
        basePersonality:
          agent.base_personality ??
          getDefaultBasePersonality(agent.specialization),
        baseStrategy:
          agent.base_strategy ?? getDefaultBaseStrategy(agent.specialization),
        riskProfile: agent.risk_profile,
        dataFocus: this.normalizeAgentDataFocus(agent),
      },
      market: {
        id: marketContext.id,
        slug: marketContext.slug,
        title: marketContext.title,
        shortDescription:
          marketContext.short_description || marketContext.title,
        description: marketContext.description,
        resolutionRule: this.buildResolutionRule(
          marketContext.rules_json,
          marketContext.description,
        ),
        scoringMethod: this.buildScoringMethod(marketContext.settlement_asset),
        startTime: marketContext.opens_at,
        endTime: marketContext.closes_at,
      },
      strategy,
    });
    const marketAgentId = createStableId("ma", `${market.id}:${agent.id}`);
    const decisionSide = this.assertStakeablePredictionSide(
      this.toStakeableDecisionSide(aiDecision.prediction.direction),
      "This AI agent abstained from taking a YES/NO side, so it cannot join this on-chain market.",
    );
    const decidedAt = new Date().toISOString();
    const promptArtifactId = createStableId(
      "prompt",
      `${marketAgentId}:${aiDecision.prompt.promptHash}`,
    );
    const battleEntryId = createStableId(
      "be",
      `${market.id}:${agent.id}:${actor.walletIdentityId}`,
    );

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const existing = await queryOne<{ id: string }>(
        client,
        "SELECT id FROM market_agents WHERE market_id = $1 AND agent_id = $2 LIMIT 1",
        [market.id, agent.id],
      );

      if (existing) {
        throw new HttpError(
          409,
          "MARKET_AGENT_ALREADY_JOINED",
          "This agent has already joined the market.",
        );
      }

      await this.insertPromptArtifact(client, {
        id: promptArtifactId,
        uri: `db://prompt_artifacts/${promptArtifactId}`,
        artifactHash: aiDecision.prompt.promptHash,
        canonicalizationVersion: aiDecision.prompt.canonicalizationVersion,
        payload: aiDecision.prompt.payload,
      });

      await client.query(
        `
          INSERT INTO market_agents (
            id, market_id, agent_id, locked_agent_version_id, joined_at, status,
            final_decision_side, final_decision_at, finalized_from_decision_id, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, now(), now()
          )
        `,
        [
          marketAgentId,
          market.id,
          agent.id,
          latestVersion.id,
          decidedAt,
          "pending_onchain",
          decisionSide,
          decidedAt,
          null,
        ],
      );

      await client.query(
        `
          INSERT INTO agent_commitments (
            id, market_agent_id, snapshot_uri, snapshot_hash, hash_algo, prompt_hash, config_hash,
            commit_tx_sig, onchain_commitment_ref, verification_status, committed_at, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, now(), now()
          )
        `,
        [
          createStableId("commit", marketAgentId),
          marketAgentId,
          `db://prompt_artifacts/${promptArtifactId}`,
          aiDecision.prompt.snapshotHash,
          "sha256",
          aiDecision.prompt.promptHash,
          aiDecision.prompt.configHash,
          null,
          null,
          "pending_onchain",
          decidedAt,
        ],
      );

      const decisionId = createStableId(
        "dec",
        `${marketAgentId}:1:${aiDecision.reasonHash}`,
      );
      await client.query(
        `
          INSERT INTO agent_market_decisions (
            id, market_agent_id, sequence_no, decision_side, confidence, reason_summary,
            key_signals, risk_factors, reason_hash, decided_at, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, now()
          )
        `,
        [
          decisionId,
          marketAgentId,
          1,
          decisionSide,
          aiDecision.prediction.confidence,
          aiDecision.prediction.reasoningSummary,
          JSON.stringify(aiDecision.keySignals),
          JSON.stringify(aiDecision.riskFactors),
          aiDecision.reasonHash,
          decidedAt,
        ],
      );

      await client.query(
        `
          UPDATE market_agents
          SET finalized_from_decision_id = $1, updated_at = now()
          WHERE id = $2
        `,
        [decisionId, marketAgentId],
      );

      await client.query(
        `
          INSERT INTO battle_entries (
            id,
            market_id,
            market_agent_id,
            agent_id,
            wallet_identity_id,
            strategy_preset,
            technical_weight,
            news_weight,
            sentiment_weight,
            macro_weight,
            onchain_weight,
            optional_insight,
            stake_amount,
            prediction_json,
            prediction_hash,
            status,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::numeric, $14::jsonb, $15, $16, now(), now()
          )
        `,
        [
          battleEntryId,
          market.id,
          marketAgentId,
          agent.id,
          actor.walletIdentityId,
          strategy.preset,
          strategy.technicalWeight,
          strategy.newsWeight,
          strategy.sentimentWeight,
          strategy.macroWeight,
          strategy.onchainWeight,
          strategy.optionalInsight,
          strategy.stakeUsdc,
          JSON.stringify(aiDecision.prediction),
          aiDecision.predictionHash,
          "pending_onchain",
        ],
      );

      await client.query("COMMIT");

      return {
        data: {
          market_agent_id: marketAgentId,
          market: {
            id: market.id,
            slug: market.slug,
            title: market.title,
          },
          agent: {
            id: agent.id,
            slug: agent.slug,
            name: agent.name,
          },
          ai: {
            provider: aiDecision.provider,
            model: aiDecision.model,
          },
          prompt_artifact: {
            id: promptArtifactId,
            uri: `db://prompt_artifacts/${promptArtifactId}`,
            prompt_hash: aiDecision.prompt.promptHash,
            config_hash: aiDecision.prompt.configHash,
            snapshot_hash: aiDecision.prompt.snapshotHash,
          },
          battle_entry: {
            id: battleEntryId,
            status: "pending_onchain",
            strategy_preset: strategy.preset,
            stake_usdc: strategy.stakeUsdc,
            prediction_hash: aiDecision.predictionHash,
            prediction_json: aiDecision.prediction,
          },
          commitment: {
            verification_status: "pending_onchain",
            prompt_hash: aiDecision.prompt.promptHash,
            config_hash: aiDecision.prompt.configHash,
            snapshot_hash: aiDecision.prompt.snapshotHash,
          },
          decision: {
            id: decisionId,
            sequence_no: 1,
            side: decisionSide,
            confidence: aiDecision.prediction.confidence,
            reason_summary: aiDecision.prediction.reasoningSummary,
            reason_hash: aiDecision.reasonHash,
            key_signals: aiDecision.keySignals,
            risk_factors: aiDecision.riskFactors,
            decided_at: decidedAt,
          },
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof HttpError) {
        throw error;
      }

      if (isPgErrorCode(error, "23505")) {
        throw new HttpError(
          409,
          "MARKET_AGENT_ALREADY_JOINED",
          "This agent has already joined the market.",
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async refreshLiveMarketDecisions(
    now = new Date(),
  ): Promise<RefreshAiDecisionsResult> {
    if (!this.env.AUTONOMOUS_AI_DECISION_REFRESH_ENABLED) {
      return {
        decisionsRefreshed: 0,
        skipped: 0,
        errors: [],
      };
    }

    const candidates = await this.findDecisionRefreshCandidates(now);
    let decisionsRefreshed = 0;
    let skipped = 0;
    const errors: RefreshAiDecisionsResult["errors"] = [];

    for (const candidate of candidates) {
      try {
        const refreshed = await this.refreshDecisionCandidate(candidate, now);

        if (refreshed) {
          decisionsRefreshed += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        errors.push({
          marketId: candidate.market_id,
          marketAgentId: candidate.market_agent_id,
          message:
            error instanceof Error
              ? error.message
              : "Unknown AI decision refresh error.",
        });
      }
    }

    return {
      decisionsRefreshed,
      skipped,
      errors,
    };
  }

  async recordStakeConfirmation(
    actor: RequestAuth,
    marketIdOrSlug: string,
    agentIdOrSlug: string,
    input: StakeConfirmationInput,
  ) {
    const submittedStakeUsdc = this.normalizePositiveDecimal(
      input.stakeUsdc,
      "stake_usdc",
    );
    const submittedStakeAmountBaseUnits = this.normalizePositiveInteger(
      input.stakeAmountBaseUnits,
      "stake_amount_base_units",
    );
    const market = await this.requireMarketContext(marketIdOrSlug);
    const effectiveMarketStatus = getEffectiveMarketStatus(market);
    const marketContext = { ...market, status: effectiveMarketStatus };
    this.assertMarketStakeable(marketContext);

    const commitIncluded = Boolean(input.commitIncluded);
    const marketAgent = await this.requireMarketAgentForStake(
      market.id,
      agentIdOrSlug,
      commitIncluded,
    );
    if (input.marketAgentId && input.marketAgentId !== marketAgent.id) {
      throw new HttpError(
        400,
        "MARKET_AGENT_MISMATCH",
        "market_agent_id does not match the selected market agent.",
      );
    }

    if (!marketAgent.commitment_id) {
      throw new HttpError(
        409,
        "AGENT_COMMITMENT_MISSING",
        "This market agent does not have a commitment record yet.",
      );
    }

    if (!marketAgent.final_decision_side) {
      throw new HttpError(
        409,
        "AGENT_DECISION_MISSING",
        "This market agent does not have a finalized decision yet.",
      );
    }

    this.assertStakeablePredictionSide(
      marketAgent.final_decision_side,
      "This market agent does not have a YES/NO decision, so it cannot receive on-chain positions.",
    );

    if (!marketAgent.onchain_commitment_ref && !commitIncluded) {
      throw new HttpError(
        409,
        "AGENT_NOT_COMMITTED_ONCHAIN",
        "This agent is not committed on-chain yet. The agent owner must finish the join transaction first.",
      );
    }

    const onchainCommitmentRef = this.assertValidSolanaPublicKey(
      input.onchainCommitmentRef,
      "onchain_commitment_ref",
    );
    if (
      marketAgent.onchain_commitment_ref &&
      marketAgent.onchain_commitment_ref !== onchainCommitmentRef
    ) {
      throw new HttpError(
        400,
        "COMMITMENT_REF_MISMATCH",
        "onchain_commitment_ref does not match the selected market agent commitment.",
      );
    }

    const onchainPositionRef = this.assertValidSolanaPublicKey(
      input.onchainPositionRef,
      "onchain_position_ref",
    );
    this.assertStakeSyncRefsMatchExpected({
      actorWalletAddress: actor.walletAddress,
      marketAgent,
      marketOnchainPubkey: marketContext.onchain_market_pubkey,
      onchainCommitmentRef,
      onchainPositionRef,
    });
    let txSig = input.txSig
      ? this.assertValidSolanaSignature(input.txSig)
      : null;
    const userTokenAccount = input.userTokenAccount
      ? this.assertValidSolanaPublicKey(
          input.userTokenAccount,
          "user_token_account",
        )
      : null;
    const vaultPubkey = input.vaultPubkey
      ? this.assertValidSolanaPublicKey(input.vaultPubkey, "vault_pubkey")
      : null;
    const shouldUpdateCommitment =
      commitIncluded || marketAgent.verification_status === "pending_onchain";
    txSig = await this.resolveStakeTransactionSignature({
      txSig,
      onchainCommitmentRef,
      onchainPositionRef,
      requireCommitmentAccount: shouldUpdateCommitment,
    });
    const signatureStatus = txSig
      ? await this.getOnchainSignatureStatus(txSig)
      : null;
    if (signatureStatus?.failed) {
      throw new HttpError(
        409,
        "ONCHAIN_TX_FAILED",
        "The submitted on-chain transaction failed.",
      );
    }

    const synchronizedStake = await this.assertStakeSyncReady({
      actorWalletAddress: actor.walletAddress,
      expectedDecisionSide: marketAgent.final_decision_side,
      marketOnchainPubkey: marketContext.onchain_market_pubkey,
      onchainCommitmentRef,
      onchainPositionRef,
      requireCommitmentAccount: shouldUpdateCommitment,
      submittedStakeAmountBaseUnits,
      submittedStakeUsdc,
      txSig,
    });

    const verificationStatus = "verified";
    const positionId = createStableId(
      "pos",
      `${market.id}:${marketAgent.id}:${actor.walletIdentityId}:${onchainPositionRef}`,
    );
    const recordedAt = new Date().toISOString();

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      await this.assertCommitmentRefAvailableForMarketAgent(
        client,
        market.id,
        marketAgent.id,
        onchainCommitmentRef,
      );
      await this.assertPositionRefAvailableForWalletPosition(
        client,
        market.id,
        actor.walletIdentityId,
        marketAgent.id,
        onchainPositionRef,
      );

      await client.query(
        `
          UPDATE agent_commitments
          SET
            commit_tx_sig = CASE WHEN $2::boolean AND $3::text IS NOT NULL THEN $3::text ELSE commit_tx_sig END,
            onchain_commitment_ref = COALESCE($4::text, onchain_commitment_ref),
            verification_status = CASE WHEN $5::boolean THEN $6::text ELSE verification_status END,
            updated_at = now()
          WHERE id = $1
        `,
        [
          marketAgent.commitment_id,
          commitIncluded,
          txSig,
          onchainCommitmentRef,
          shouldUpdateCommitment,
          verificationStatus,
        ],
      );

      if (shouldUpdateCommitment) {
        await client.query(
          `
            UPDATE market_agents
            SET status = 'active', updated_at = now()
            WHERE id = $1 AND status <> 'active'
          `,
          [marketAgent.id],
        );
      }

      const position = await queryOne<{
        id: string;
        previous_stake_usdc: string;
        stake_usdc: string;
        position_units: string | null;
        onchain_position_ref: string | null;
        open_tx_sig: string | null;
        status: string;
        created_at: string;
        updated_at: string;
      }>(
        client,
        `
          WITH existing AS (
            SELECT stake_usdc
            FROM user_positions
            WHERE id = $1
          ),
          upserted AS (
            INSERT INTO user_positions (
              id, wallet_identity_id, market_id, market_agent_id, stake_usdc, position_units,
              onchain_position_ref, open_tx_sig, status, created_at, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5::numeric, $6::numeric,
              $7, $8, $9, now(), now()
            )
            ON CONFLICT (id) DO UPDATE
            SET
              stake_usdc = excluded.stake_usdc,
              position_units = excluded.position_units,
              onchain_position_ref = excluded.onchain_position_ref,
              open_tx_sig = COALESCE(excluded.open_tx_sig, user_positions.open_tx_sig),
              status = excluded.status,
              updated_at = now()
            RETURNING
              id,
              stake_usdc::text,
              position_units::text,
              onchain_position_ref,
              open_tx_sig,
              status,
              created_at::text,
              updated_at::text
          )
          SELECT
            upserted.*,
            COALESCE((SELECT stake_usdc::text FROM existing), '0') AS previous_stake_usdc
          FROM upserted
        `,
        [
          positionId,
          actor.walletIdentityId,
          market.id,
          marketAgent.id,
          synchronizedStake.stakeUsdc,
          synchronizedStake.stakeUsdc,
          onchainPositionRef,
          txSig,
          "open",
        ],
      );

      if (!position) {
        throw new HttpError(
          500,
          "POSITION_RECORD_FAILED",
          "Failed to record the user position.",
        );
      }

      await client.query(
        `
          UPDATE markets
          SET total_liquidity_usdc = total_liquidity_usdc + ($2::numeric - $3::numeric),
              updated_at = now()
          WHERE id = $1
        `,
        [market.id, position.stake_usdc, position.previous_stake_usdc],
      );

      const monitoring = await this.insertMonitoringPoint(
        client,
        market.id,
        recordedAt,
        txSig ?? onchainPositionRef,
      );

      await client.query(
        `
          UPDATE battle_entries
          SET
            stake_amount = $2::numeric,
            status = 'locked',
            updated_at = now()
          WHERE market_agent_id = $1
            AND wallet_identity_id = $3
        `,
        [marketAgent.id, synchronizedStake.stakeUsdc, actor.walletIdentityId],
      );

      await client.query("COMMIT");

      return {
        data: {
          market: {
            id: market.id,
            slug: market.slug,
            title: market.title,
          },
          agent: {
            id: marketAgent.agent_id,
            slug: marketAgent.agent_slug,
            name: marketAgent.agent_name,
          },
          market_agent_id: marketAgent.id,
          commitment: {
            commit_tx_sig: commitIncluded
              ? (txSig ?? marketAgent.commit_tx_sig)
              : marketAgent.commit_tx_sig,
            onchain_commitment_ref: onchainCommitmentRef,
            verification_status: shouldUpdateCommitment
              ? verificationStatus
              : marketAgent.verification_status,
          },
          position: {
            id: position.id,
            stake_usdc: position.stake_usdc,
            position_units: position.position_units,
            onchain_position_ref: position.onchain_position_ref,
            open_tx_sig: position.open_tx_sig,
            status: position.status,
            opened_at: position.created_at,
            updated_at: position.updated_at,
            stake_amount_base_units: synchronizedStake.stakeAmountBaseUnits,
            user_token_account: userTokenAccount,
            vault_pubkey: vaultPubkey,
          },
          onchain: {
            tx_sig: txSig,
            signature_status: signatureStatus,
          },
          monitoring,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof HttpError) {
        throw error;
      }

      throw error;
    } finally {
      client.release();
    }
  }

  private async requireMarketContext(marketIdOrSlug: string) {
    const market = await queryOne<MarketContextRow>(
      this.db,
      `
        SELECT
          m.id,
          m.slug,
          m.title,
          m.short_description,
          m.description,
          m.status,
          m.onchain_market_pubkey,
          m.oracle_source,
          m.settlement_asset,
          m.rules_json,
          m.opens_at::text,
          m.join_deadline_at::text,
          m.decision_cutoff_at::text,
          m.closes_at::text,
          m.resolves_at::text,
          c.slug AS category_slug,
          c.name AS category_name
        FROM markets m
        JOIN categories c ON c.id = m.category_id
        WHERE m.id = $1 OR m.slug = $2
        LIMIT 1
      `,
      [marketIdOrSlug, marketIdOrSlug],
    );

    if (!market) {
      throw new HttpError(
        404,
        "MARKET_NOT_FOUND",
        `Market '${marketIdOrSlug}' was not found.`,
      );
    }

    return market;
  }

  private assertMarketJoinable(market: MarketContextRow) {
    if (!["open", "upcoming"].includes(market.status)) {
      throw new HttpError(
        409,
        "MARKET_NOT_JOINABLE",
        "Agents can only join open or upcoming markets.",
      );
    }

    if (Date.parse(market.join_deadline_at) <= Date.now()) {
      throw new HttpError(
        409,
        "MARKET_JOIN_WINDOW_CLOSED",
        "The market join window has already closed.",
      );
    }
  }

  private assertMarketStakeable(market: MarketContextRow) {
    if (!["open", "upcoming"].includes(market.status)) {
      throw new HttpError(
        409,
        "MARKET_NOT_STAKEABLE",
        "Positions can only be opened for open or upcoming markets.",
      );
    }

    if (Date.parse(market.join_deadline_at) <= Date.now()) {
      throw new HttpError(
        409,
        "MARKET_POSITION_WINDOW_CLOSED",
        "The market position window has already closed.",
      );
    }

    this.assertValidSolanaPublicKey(
      market.onchain_market_pubkey,
      "market.onchain_market_pubkey",
    );
  }

  private async requireMarketAgentForStake(
    marketId: string,
    agentIdOrSlug: string,
    allowPendingOnchain = false,
  ) {
    const marketAgent = await queryOne<StakeMarketAgentRow>(
      this.db,
      `
        SELECT
          ma.id,
          ma.market_id,
          ma.agent_id,
          a.slug AS agent_slug,
          a.name AS agent_name,
          owner.wallet_address AS owner_wallet_address,
          ma.final_decision_side,
          ma.status,
          ac.id AS commitment_id,
          ac.commit_tx_sig,
          ac.onchain_commitment_ref,
          ac.verification_status
        FROM market_agents ma
        JOIN agents a ON a.id = ma.agent_id
        LEFT JOIN wallet_identities owner ON owner.id = a.owner_wallet_identity_id
        LEFT JOIN agent_commitments ac ON ac.market_agent_id = ma.id
        WHERE ma.market_id = $1
          AND (ma.id = $2 OR a.id = $2 OR a.slug = $2)
        LIMIT 1
      `,
      [marketId, agentIdOrSlug],
    );

    if (!marketAgent) {
      throw new HttpError(
        404,
        "MARKET_AGENT_NOT_FOUND",
        `Market agent '${agentIdOrSlug}' was not found.`,
      );
    }

    if (
      marketAgent.status !== "active" &&
      !(
        marketAgent.status === "pending_onchain" &&
        (allowPendingOnchain || Boolean(marketAgent.onchain_commitment_ref))
      )
    ) {
      throw new HttpError(
        409,
        "MARKET_AGENT_NOT_ACTIVE",
        "Only active market agents can receive positions.",
      );
    }

    return marketAgent;
  }

  private async getRetryableExistingJoinResult(
    market: MarketContextRow,
    agent: AgentContextRow,
  ) {
    const existing = await queryOne<ExistingJoinRow>(
      this.db,
      `
        SELECT
          ma.id AS market_agent_id,
          a.id AS agent_id,
          a.slug AS agent_slug,
          a.name AS agent_name,
          ac.verification_status,
          ac.prompt_hash,
          ac.config_hash,
          ac.snapshot_hash,
          d.sequence_no,
          d.decision_side,
          d.confidence,
          d.reason_summary,
          d.key_signals,
          d.risk_factors,
          d.reason_hash,
          d.decided_at::text
        FROM market_agents ma
        JOIN agents a ON a.id = ma.agent_id
        LEFT JOIN agent_commitments ac ON ac.market_agent_id = ma.id
        LEFT JOIN LATERAL (
          SELECT
            sequence_no,
            decision_side,
            confidence,
            reason_summary,
            COALESCE(key_signals, '[]'::jsonb) AS key_signals,
            COALESCE(risk_factors, '[]'::jsonb) AS risk_factors,
            reason_hash,
            decided_at
          FROM agent_market_decisions
          WHERE market_agent_id = ma.id
          ORDER BY sequence_no DESC
          LIMIT 1
        ) d ON true
        WHERE ma.market_id = $1 AND ma.agent_id = $2
        LIMIT 1
      `,
      [market.id, agent.id],
    );

    if (!existing) {
      return null;
    }

    if (
      !["pending_onchain", "submitted"].includes(
        existing.verification_status ?? "",
      )
    ) {
      throw new HttpError(
        409,
        "MARKET_AGENT_ALREADY_JOINED",
        "This agent has already joined the market.",
      );
    }

    if (
      !existing.prompt_hash ||
      !existing.config_hash ||
      !existing.snapshot_hash ||
      !existing.decision_side ||
      existing.confidence === null ||
      !existing.reason_summary ||
      !existing.reason_hash ||
      !existing.decided_at ||
      existing.sequence_no === null
    ) {
      throw new HttpError(
        409,
        "MARKET_AGENT_JOIN_INCOMPLETE",
        "This agent join is incomplete and cannot be retried.",
      );
    }

    const decisionSide = this.assertStakeablePredictionSide(
      existing.decision_side,
      "This AI agent abstained from taking a YES/NO side, so it cannot join this on-chain market.",
    );

    return {
      data: {
        already_joined: true,
        market_agent_id: existing.market_agent_id,
        market: {
          id: market.id,
          slug: market.slug,
          title: market.title,
        },
        agent: {
          id: existing.agent_id,
          slug: existing.agent_slug,
          name: existing.agent_name,
        },
        commitment: {
          verification_status: existing.verification_status,
          prompt_hash: existing.prompt_hash,
          config_hash: existing.config_hash,
          snapshot_hash: existing.snapshot_hash,
        },
        decision: {
          id: createStableId(
            "dec",
            `${existing.market_agent_id}:${existing.sequence_no}:${existing.reason_hash}`,
          ),
          sequence_no: Number(existing.sequence_no),
          side: decisionSide,
          confidence: existing.confidence,
          reason_summary: existing.reason_summary,
          key_signals: existing.key_signals ?? [],
          risk_factors: existing.risk_factors ?? [],
          reason_hash: existing.reason_hash,
          decided_at: existing.decided_at,
        },
      },
    };
  }

  private async requireAgentContext(agentIdOrSlug: string) {
    const agent = await queryOne<AgentContextRow>(
      this.db,
      `
        SELECT
          a.id,
          a.slug,
          a.name,
          a.description,
          a.status,
          a.specialization,
          a.base_personality,
          a.base_strategy,
          a.risk_profile,
          a.data_focus,
          a.owner_wallet_identity_id,
          w.wallet_address AS owner_wallet_address
        FROM agents a
        LEFT JOIN wallet_identities w ON w.id = a.owner_wallet_identity_id
        WHERE a.id = $1 OR a.slug = $2
        LIMIT 1
      `,
      [agentIdOrSlug, agentIdOrSlug],
    );

    if (!agent) {
      throw new HttpError(
        404,
        "AGENT_NOT_FOUND",
        `Agent '${agentIdOrSlug}' was not found.`,
      );
    }

    if (agent.status !== "active") {
      throw new HttpError(
        409,
        "AGENT_NOT_ACTIVE",
        "Only active agents can join markets.",
      );
    }

    return agent;
  }

  private assertCanUseAgent(actor: RequestAuth, agent: AgentContextRow) {
    if (actor.isAdmin) {
      return;
    }

    if (
      agent.owner_wallet_address &&
      agent.owner_wallet_address === actor.walletAddress
    ) {
      return;
    }

    throw new HttpError(
      403,
      "AGENT_ACCESS_FORBIDDEN",
      "You can only join markets with agents owned by your wallet.",
    );
  }

  private async assertOwnerJoinSlotAvailable(
    marketId: string,
    agent: AgentContextRow,
  ) {
    if (!agent.owner_wallet_identity_id) {
      return;
    }

    const conflictingJoin = await queryOne<{
      market_agent_id: string;
      agent_name: string;
      agent_slug: string;
    }>(
      this.db,
      `
        SELECT
          ma.id AS market_agent_id,
          a.name AS agent_name,
          a.slug AS agent_slug
        FROM market_agents ma
        JOIN agents a ON a.id = ma.agent_id
        WHERE ma.market_id = $1
          AND a.owner_wallet_identity_id = $2
          AND a.id <> $3
        LIMIT 1
      `,
      [marketId, agent.owner_wallet_identity_id, agent.id],
    );

    if (!conflictingJoin) {
      return;
    }

    throw new HttpError(
      409,
      "OWNER_MARKET_AGENT_LIMIT",
      `This wallet already has '${conflictingJoin.agent_name}' joined in this market. The current on-chain program supports only one AI agent per wallet per market.`,
    );
  }

  private async findDecisionRefreshCandidates(now: Date) {
    const staleBefore = this.getDecisionRefreshStaleBefore(now);

    return queryRows<DecisionRefreshCandidateRow>(
      this.db,
      `
        WITH latest_decisions AS (
          SELECT DISTINCT ON (d.market_agent_id)
            d.market_agent_id,
            d.sequence_no,
            d.decision_side,
            d.confidence,
            d.decided_at
          FROM agent_market_decisions d
          ORDER BY d.market_agent_id, d.sequence_no DESC, d.decided_at DESC
        )
        SELECT
          m.id AS market_id,
          m.slug AS market_slug,
          m.title AS market_title,
          m.short_description AS market_short_description,
          m.description AS market_description,
          m.oracle_source AS market_oracle_source,
          m.settlement_asset AS market_settlement_asset,
          m.rules_json AS market_rules_json,
          m.opens_at::text AS market_opens_at,
          m.join_deadline_at::text AS market_join_deadline_at,
          m.decision_cutoff_at::text AS market_decision_cutoff_at,
          m.closes_at::text AS market_closes_at,
          c.slug AS category_slug,
          ma.id AS market_agent_id,
          a.id AS agent_id,
          a.slug AS agent_slug,
          a.name AS agent_name,
          a.description AS agent_description,
          a.specialization AS agent_specialization,
          a.base_personality AS agent_base_personality,
          a.base_strategy AS agent_base_strategy,
          a.risk_profile AS agent_risk_profile,
          a.data_focus AS agent_data_focus,
          be.strategy_preset,
          be.technical_weight,
          be.news_weight,
          be.sentiment_weight,
          be.macro_weight,
          be.onchain_weight,
          be.optional_insight,
          be.stake_amount::text,
          latest_decisions.sequence_no AS latest_sequence_no,
          latest_decisions.decision_side AS latest_decision_side,
          latest_decisions.confidence AS latest_confidence,
          latest_decisions.decided_at::text AS latest_decided_at
        FROM markets m
        JOIN categories c ON c.id = m.category_id
        JOIN market_agents ma ON ma.market_id = m.id
        JOIN agents a ON a.id = ma.agent_id
        JOIN agent_commitments ac ON ac.market_agent_id = ma.id
        JOIN battle_entries be ON be.market_agent_id = ma.id
        LEFT JOIN latest_decisions ON latest_decisions.market_agent_id = ma.id
        WHERE m.status IN ('open', 'upcoming')
          AND m.join_deadline_at <= $1::timestamptz
          AND m.decision_cutoff_at > $1::timestamptz
          AND ma.status = 'active'
          AND NULLIF(ac.onchain_commitment_ref, '') IS NOT NULL
          AND be.status IN ('locked', 'resolved', 'claimed')
          AND COALESCE(latest_decisions.sequence_no, 0) < $3
          AND (
            latest_decisions.decided_at IS NULL
            OR latest_decisions.decided_at <= $2::timestamptz
          )
        ORDER BY
          COALESCE(latest_decisions.decided_at, ma.joined_at) ASC,
          ma.joined_at ASC
        LIMIT $4
      `,
      [
        now.toISOString(),
        staleBefore.toISOString(),
        this.env.AUTONOMOUS_AI_DECISION_REFRESH_MAX_SEQUENCE,
        this.env.AUTONOMOUS_AI_DECISION_REFRESH_BATCH_SIZE,
      ],
    );
  }

  private async refreshDecisionCandidate(
    candidate: DecisionRefreshCandidateRow,
    now: Date,
  ) {
    const newsContext = await this.getNewsContext(
      candidate.market_id,
      candidate.category_slug,
    );
    const strategy = this.buildDecisionRefreshStrategy(
      candidate,
      now,
      newsContext,
    );
    const aiDecision = await this.battlePredictionService.generatePrediction({
      agent: this.buildDecisionRefreshAgent(candidate),
      market: {
        id: candidate.market_id,
        slug: candidate.market_slug,
        title: candidate.market_title,
        shortDescription:
          candidate.market_short_description || candidate.market_title,
        description: candidate.market_description,
        resolutionRule: this.buildResolutionRule(
          candidate.market_rules_json,
          candidate.market_description,
        ),
        scoringMethod: this.buildScoringMethod(
          candidate.market_settlement_asset,
        ),
        startTime: candidate.market_opens_at,
        endTime: candidate.market_closes_at,
      },
      strategy,
    });
    const decisionSide = this.assertStakeablePredictionSide(
      this.toStakeableDecisionSide(aiDecision.prediction.direction),
      "This AI agent abstained from the live refresh, so the previous decision remains active.",
    );
    const decidedAt = new Date().toISOString();
    const staleBefore = this.getDecisionRefreshStaleBefore(now);
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const marketAgent = await queryOne<{ status: string }>(
        client,
        `
          SELECT status
          FROM market_agents
          WHERE id = $1
          FOR UPDATE
          LIMIT 1
        `,
        [candidate.market_agent_id],
      );

      if (!marketAgent || marketAgent.status !== "active") {
        await client.query("ROLLBACK");
        return false;
      }

      const latestDecision = await queryOne<{
        sequence_no: number;
        decided_at: string;
      }>(
        client,
        `
          SELECT sequence_no, decided_at::text
          FROM agent_market_decisions
          WHERE market_agent_id = $1
          ORDER BY sequence_no DESC, decided_at DESC
          LIMIT 1
        `,
        [candidate.market_agent_id],
      );

      if (
        latestDecision &&
        Date.parse(latestDecision.decided_at) > staleBefore.getTime()
      ) {
        await client.query("ROLLBACK");
        return false;
      }

      const sequenceNo = (latestDecision?.sequence_no ?? 0) + 1;
      if (sequenceNo > this.env.AUTONOMOUS_AI_DECISION_REFRESH_MAX_SEQUENCE) {
        await client.query("ROLLBACK");
        return false;
      }

      const promptArtifactId = createStableId(
        "prompt",
        `${candidate.market_agent_id}:${sequenceNo}:${aiDecision.prompt.promptHash}`,
      );
      const decisionId = createStableId(
        "dec",
        `${candidate.market_agent_id}:${sequenceNo}:${aiDecision.reasonHash}`,
      );

      await this.insertPromptArtifact(client, {
        id: promptArtifactId,
        uri: `db://prompt_artifacts/${promptArtifactId}`,
        artifactHash: aiDecision.prompt.promptHash,
        canonicalizationVersion: aiDecision.prompt.canonicalizationVersion,
        payload: aiDecision.prompt.payload,
      });

      await client.query(
        `
          INSERT INTO agent_market_decisions (
            id, market_agent_id, sequence_no, decision_side, confidence, reason_summary,
            key_signals, risk_factors, reason_hash, decided_at, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, now()
          )
        `,
        [
          decisionId,
          candidate.market_agent_id,
          sequenceNo,
          decisionSide,
          aiDecision.prediction.confidence,
          aiDecision.prediction.reasoningSummary,
          JSON.stringify(aiDecision.keySignals),
          JSON.stringify(aiDecision.riskFactors),
          aiDecision.reasonHash,
          decidedAt,
        ],
      );

      await client.query(
        `
          UPDATE market_agents
          SET final_decision_side = $1,
              final_decision_at = $2::timestamptz,
              finalized_from_decision_id = $3,
              updated_at = now()
          WHERE id = $4
        `,
        [decisionSide, decidedAt, decisionId, candidate.market_agent_id],
      );

      await client.query(
        `
          UPDATE battle_entries
          SET prediction_json = $1::jsonb,
              prediction_hash = $2,
              updated_at = now()
          WHERE market_agent_id = $3
        `,
        [
          JSON.stringify(aiDecision.prediction),
          aiDecision.predictionHash,
          candidate.market_agent_id,
        ],
      );

      await this.insertMonitoringPoint(
        client,
        candidate.market_id,
        decidedAt,
        `decision-refresh:${candidate.market_agent_id}:${sequenceNo}`,
      );

      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private buildDecisionRefreshAgent(candidate: DecisionRefreshCandidateRow) {
    const agentContext: AgentContextRow = {
      id: candidate.agent_id,
      slug: candidate.agent_slug,
      name: candidate.agent_name,
      description: candidate.agent_description,
      status: "active",
      specialization: candidate.agent_specialization,
      base_personality: candidate.agent_base_personality,
      base_strategy: candidate.agent_base_strategy,
      risk_profile: candidate.agent_risk_profile,
      data_focus: candidate.agent_data_focus,
      owner_wallet_identity_id: null,
      owner_wallet_address: null,
    };

    return {
      id: candidate.agent_id,
      name: candidate.agent_name,
      specialization: candidate.agent_specialization,
      description: candidate.agent_description,
      basePersonality:
        candidate.agent_base_personality ??
        getDefaultBasePersonality(candidate.agent_specialization),
      baseStrategy:
        candidate.agent_base_strategy ??
        getDefaultBaseStrategy(candidate.agent_specialization),
      riskProfile: candidate.agent_risk_profile,
      dataFocus: this.normalizeAgentDataFocus(agentContext),
    };
  }

  private buildDecisionRefreshStrategy(
    candidate: DecisionRefreshCandidateRow,
    now: Date,
    newsContext: DecisionRefreshNewsContextItem[],
  ): ResolvedBattleStrategy {
    const strategy = {
      preset: candidate.strategy_preset,
      technicalWeight: candidate.technical_weight,
      newsWeight: candidate.news_weight,
      sentimentWeight: candidate.sentiment_weight,
      macroWeight: candidate.macro_weight,
      onchainWeight: candidate.onchain_weight,
      optionalInsight: [
        candidate.optional_insight?.trim() || null,
        this.buildDecisionRefreshInsight(candidate, now, newsContext),
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n\n"),
      stakeUsdc: candidate.stake_amount,
    } satisfies ResolvedBattleStrategy;

    if (sumBattleWeights(strategy) !== 100) {
      throw new HttpError(
        400,
        "BATTLE_STRATEGY_INVALID",
        "Signal weights must total 100 before refreshing an AI decision.",
      );
    }

    return strategy;
  }

  private buildDecisionRefreshInsight(
    candidate: DecisionRefreshCandidateRow,
    now: Date,
    newsContext: DecisionRefreshNewsContextItem[],
  ) {
    const previousDecision =
      candidate.latest_decision_side && candidate.latest_confidence !== null
        ? `${candidate.latest_decision_side} at ${(candidate.latest_confidence * 100).toFixed(1)}% confidence`
        : "no previous visible decision";
    const latestNews = newsContext
      .slice(0, 5)
      .map((item) => {
        const summary = item.summary ? ` - ${item.summary}` : "";
        return `- ${item.title}${summary} (${item.sourceName}, ${item.publishedAt})`;
      })
      .join("\n");

    return [
      `Live battle refresh at ${now.toISOString()}.`,
      `Previous decision: ${previousDecision}.`,
      "Re-evaluate the market as a fresh live decision update. Keep continuity with the prior stance only when the evidence still supports it.",
      latestNews ? `Recent linked news:\n${latestNews}` : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n");
  }

  private getDecisionRefreshStaleBefore(now: Date) {
    return new Date(
      now.getTime() -
        this.env.AUTONOMOUS_AI_DECISION_REFRESH_INTERVAL_SECONDS * 1000,
    );
  }

  private resolveBattleStrategyInput(
    input: JoinAgentInput,
  ): ResolvedBattleStrategy {
    const preset = input.strategyPreset ?? "hybrid";
    const defaultWeights = strategyPresetWeights[preset];
    const resolved = {
      preset,
      technicalWeight: input.technicalWeight ?? defaultWeights.technicalWeight,
      newsWeight: input.newsWeight ?? defaultWeights.newsWeight,
      sentimentWeight: input.sentimentWeight ?? defaultWeights.sentimentWeight,
      macroWeight: input.macroWeight ?? defaultWeights.macroWeight,
      onchainWeight: input.onchainWeight ?? defaultWeights.onchainWeight,
      optionalInsight:
        input.optionalInsight?.trim() || input.userPrompt?.trim() || null,
      stakeUsdc: input.stakeUsdc
        ? this.normalizePositiveDecimal(input.stakeUsdc, "stake_usdc")
        : "0.000000000000",
    } satisfies ResolvedBattleStrategy;

    if (sumBattleWeights(resolved) !== 100) {
      throw new HttpError(
        400,
        "BATTLE_STRATEGY_INVALID",
        "Signal weights must total 100.",
      );
    }

    return resolved;
  }

  private normalizeAgentDataFocus(agent: AgentContextRow): DataFocus[] {
    if (!Array.isArray(agent.data_focus)) {
      return getDefaultDataFocus(agent.specialization);
    }

    const normalized = [
      ...new Set(
        agent.data_focus.filter(
          (entry): entry is DataFocus => typeof entry === "string",
        ),
      ),
    ];

    return normalized.length
      ? normalized
      : getDefaultDataFocus(agent.specialization);
  }

  private buildResolutionRule(value: unknown, fallbackDescription: string) {
    if (Array.isArray(value) && value.length) {
      return value
        .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
        .join(" ");
    }

    return fallbackDescription;
  }

  private buildScoringMethod(settlementAsset: string) {
    return `Oracle outcome settlement with pooled staking and ${settlementAsset} payout scoring.`;
  }

  private toStakeableDecisionSide(
    direction: BattlePredictionJson["direction"],
  ): string {
    if (direction === "yes" || direction === "bullish") {
      return "yes";
    }

    if (direction === "no" || direction === "bearish") {
      return "no";
    }

    return "abstain";
  }

  private async getMarketTopics(marketId: string) {
    return queryRows<{ slug: string; name: string }>(
      this.db,
      `
        SELECT t.slug, t.name
        FROM market_topics mt
        JOIN topics t ON t.id = mt.topic_id
        WHERE mt.market_id = $1
        ORDER BY mt.is_primary DESC, t.name ASC
      `,
      [marketId],
    );
  }

  private async getAgentCategories(agentId: string) {
    return queryRows<{ slug: string; name: string }>(
      this.db,
      `
        SELECT c.slug, c.name
        FROM agent_categories ac
        JOIN categories c ON c.id = ac.category_id
        WHERE ac.agent_id = $1
        ORDER BY ac.is_primary DESC, c.name ASC
      `,
      [agentId],
    );
  }

  private async assertCommitmentRefAvailableForMarketAgent(
    db: AppDatabase | PoolClient,
    marketId: string,
    marketAgentId: string,
    onchainCommitmentRef: string,
  ) {
    const conflictingCommitment = await queryOne<{
      market_agent_id: string;
      agent_name: string;
      agent_slug: string;
    }>(
      db,
      `
        SELECT
          ma.id AS market_agent_id,
          a.name AS agent_name,
          a.slug AS agent_slug
        FROM agent_commitments ac
        JOIN market_agents ma ON ma.id = ac.market_agent_id
        JOIN agents a ON a.id = ma.agent_id
        WHERE ma.market_id = $1
          AND ac.onchain_commitment_ref = $2
          AND ac.market_agent_id <> $3
        LIMIT 1
      `,
      [marketId, onchainCommitmentRef, marketAgentId],
    );

    if (!conflictingCommitment) {
      return;
    }

    throw new HttpError(
      409,
      "ONCHAIN_COMMITMENT_REF_IN_USE",
      `The submitted on-chain commitment ref is already linked to '${conflictingCommitment.agent_name}' in this market.`,
    );
  }

  private async assertPositionRefAvailableForWalletPosition(
    db: AppDatabase | PoolClient,
    marketId: string,
    walletIdentityId: string,
    marketAgentId: string,
    onchainPositionRef: string,
  ) {
    const conflictingPosition = await queryOne<{
      position_id: string;
      market_agent_id: string;
    }>(
      db,
      `
        SELECT
          up.id AS position_id,
          up.market_agent_id
        FROM user_positions up
        WHERE up.market_id = $1
          AND up.wallet_identity_id = $2
          AND up.onchain_position_ref = $3
          AND up.market_agent_id <> $4
        LIMIT 1
      `,
      [marketId, walletIdentityId, onchainPositionRef, marketAgentId],
    );

    if (!conflictingPosition) {
      return;
    }

    throw new HttpError(
      409,
      "ONCHAIN_POSITION_REF_IN_USE",
      "The submitted on-chain position ref is already linked to another position for this wallet in this market.",
    );
  }

  private async getNewsContext(
    marketId: string,
    categorySlug: string,
  ): Promise<
    Array<{
      title: string;
      summary: string | null;
      url: string;
      sourceName: string;
      publishedAt: string;
      isBreaking: boolean;
    }>
  > {
    const linkedNews = await queryRows<{
      title: string;
      summary: string | null;
      url: string;
      source_name: string;
      published_at: string;
      is_breaking: boolean;
    }>(
      this.db,
      `
        SELECT ni.title, ni.summary, ni.url, ns.name AS source_name, ni.published_at::text, ni.is_breaking
        FROM news_item_markets nim
        JOIN news_items ni ON ni.id = nim.news_item_id
        JOIN news_sources ns ON ns.id = ni.source_id
        WHERE nim.market_id = $1
        ORDER BY ni.published_at DESC
        LIMIT 12
      `,
      [marketId],
    );

    const rows =
      linkedNews.length > 0
        ? linkedNews
        : await queryRows<{
            title: string;
            summary: string | null;
            url: string;
            source_name: string;
            published_at: string;
            is_breaking: boolean;
          }>(
            this.db,
            `
              SELECT ni.title, ni.summary, ni.url, ns.name AS source_name, ni.published_at::text, ni.is_breaking
              FROM news_items ni
              JOIN news_sources ns ON ns.id = ni.source_id
              JOIN categories c ON c.id = ni.category_id
              WHERE c.slug = $1
              ORDER BY ni.published_at DESC
              LIMIT 12
            `,
            [categorySlug],
          );

    return rows.map((row) => ({
      title: row.title,
      summary: row.summary,
      url: row.url,
      sourceName: row.source_name,
      publishedAt: row.published_at,
      isBreaking: Boolean(row.is_breaking),
    }));
  }

  private async ensureLatestAgentVersion(
    agent: AgentContextRow,
  ): Promise<AgentVersionRow> {
    const existing = await this.getLatestAgentVersion(agent.id);
    if (existing && this.isAgentVersionCompatible(existing)) {
      return existing;
    }

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      const created = await this.createDefaultAgentVersion(
        client,
        agent,
        (existing?.version_no ?? 0) + 1,
      );
      await client.query("COMMIT");
      return created;
    } catch (error) {
      await client.query("ROLLBACK");

      const latest = await this.getLatestAgentVersion(agent.id);
      if (latest && this.isAgentVersionCompatible(latest)) {
        return latest;
      }

      throw error;
    } finally {
      client.release();
    }
  }

  private async getLatestAgentVersion(
    agentId: string,
    db: AppDatabase | PoolClient = this.db,
  ) {
    return queryOne<AgentVersionRow>(
      db,
      `
        SELECT
          id,
          version_no,
          version_label,
          model_provider,
          model_name,
          runtime_config_json,
          config_hash
        FROM agent_versions
        WHERE agent_id = $1 AND status = 'published'
        ORDER BY version_no DESC
        LIMIT 1
      `,
      [agentId],
    );
  }

  private isAgentVersionCompatible(version: AgentVersionRow) {
    const modelProvider = this.env.AI_DECISION_PROVIDER;
    const modelName = this.getDecisionModelName(modelProvider);
    return (
      version.model_provider === modelProvider &&
      version.model_name === modelName
    );
  }

  private getDecisionModelName(modelProvider: string) {
    if (modelProvider === "openai") {
      return this.env.OPENAI_MODEL;
    }

    if (modelProvider === "openrouter") {
      return this.env.OPENROUTER_MODEL;
    }

    if (modelProvider === "mock") {
      return "exoduze-battle-mock-v1";
    }

    return "exoduze-heuristic-v1";
  }

  private async createDefaultAgentVersion(
    client: PoolClient,
    agent: AgentContextRow,
    versionNo = 1,
  ): Promise<AgentVersionRow> {
    const modelProvider = this.env.AI_DECISION_PROVIDER;
    const modelName = this.getDecisionModelName(modelProvider);
    const runtimeConfig = {
      provider: modelProvider,
      model: modelName,
      schema: "exoduze.agent_market_decision.v1",
    };
    const promptPayload = {
      agent: {
        id: agent.id,
        slug: agent.slug,
        name: agent.name,
        description: agent.description,
        specialization: agent.specialization,
        base_personality:
          agent.base_personality ??
          getDefaultBasePersonality(agent.specialization),
        base_strategy:
          agent.base_strategy ?? getDefaultBaseStrategy(agent.specialization),
        risk_profile: agent.risk_profile,
        data_focus: this.normalizeAgentDataFocus(agent),
      },
      default_system: "Exoduze default agent prompt profile.",
      runtime_config: runtimeConfig,
    };
    const promptHash = hashCanonicalJson(promptPayload);
    const configHash = hashCanonicalJson(runtimeConfig);
    const versionHash = hashCanonicalJson({
      agent_id: agent.id,
      version_no: versionNo,
      prompt_hash: promptHash,
      config_hash: configHash,
    });
    const promptArtifactId = createStableId(
      "prompt",
      `${agent.id}:default:${promptHash}`,
    );
    const versionId = createStableId(
      "agv",
      `${agent.id}:${versionNo}:${versionHash}`,
    );

    await this.insertPromptArtifact(client, {
      id: promptArtifactId,
      uri: `db://prompt_artifacts/${promptArtifactId}`,
      artifactHash: promptHash,
      canonicalizationVersion: this.env.AI_CANONICALIZATION_VERSION,
      payload: promptPayload,
    });

    await client.query(
      `
        INSERT INTO agent_versions (
          id, agent_id, version_no, version_label, prompt_artifact_id, model_provider, model_name,
          runtime_config_json, config_hash, version_hash, status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8::jsonb, $9, $10, $11, now(), now()
        )
        ON CONFLICT (agent_id, version_no) DO NOTHING
      `,
      [
        versionId,
        agent.id,
        versionNo,
        `v${versionNo}`,
        promptArtifactId,
        modelProvider,
        modelName,
        JSON.stringify(runtimeConfig),
        configHash,
        versionHash,
        "published",
      ],
    );

    const latest = await this.getLatestAgentVersion(agent.id, client);
    if (!latest) {
      throw new HttpError(
        500,
        "AGENT_VERSION_CREATE_FAILED",
        "Failed to create an agent version.",
      );
    }

    return latest;
  }

  private async insertMonitoringPoint(
    client: PoolClient,
    marketId: string,
    recordedAt: string,
    txSig: string,
  ): Promise<MonitoringAggregateRow & { recorded_at: string }> {
    const aggregate = await queryOne<MonitoringAggregateRow>(
      client,
      `
        WITH agent_counts AS (
          SELECT
            COUNT(*)::integer AS total_agents_count,
            COUNT(*) FILTER (WHERE final_decision_side = 'YES')::integer AS yes_agents_count,
            COUNT(*) FILTER (WHERE final_decision_side = 'NO')::integer AS no_agents_count
          FROM market_agents
          WHERE market_id = $1 AND status = 'active'
        ),
        stake_totals AS (
          SELECT
            COALESCE(SUM(up.stake_usdc) FILTER (WHERE ma.final_decision_side = 'YES'), 0)::text AS yes_staked_usdc,
            COALESCE(SUM(up.stake_usdc) FILTER (WHERE ma.final_decision_side = 'NO'), 0)::text AS no_staked_usdc,
            COALESCE(SUM(up.stake_usdc), 0)::text AS total_staked_usdc
          FROM user_positions up
          JOIN market_agents ma ON ma.id = up.market_agent_id
          WHERE up.market_id = $1 AND up.status = 'open'
        )
        SELECT
          agent_counts.total_agents_count,
          agent_counts.yes_agents_count,
          agent_counts.no_agents_count,
          stake_totals.yes_staked_usdc,
          stake_totals.no_staked_usdc,
          stake_totals.total_staked_usdc
        FROM agent_counts
        CROSS JOIN stake_totals
      `,
      [marketId],
    );

    if (!aggregate) {
      throw new HttpError(
        500,
        "MONITORING_AGGREGATE_FAILED",
        "Failed to aggregate market monitoring data.",
      );
    }

    const monitoringPointId = createStableId(
      "mon",
      `${marketId}:${recordedAt}:${txSig}`,
    );
    await client.query(
      `
        INSERT INTO market_monitoring_points (
          id, market_id, recorded_at, yes_agents_count, no_agents_count,
          yes_staked_usdc, no_staked_usdc, total_agents_count, total_staked_usdc, created_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6::numeric, $7::numeric, $8, $9::numeric, now()
        )
        ON CONFLICT (id) DO NOTHING
      `,
      [
        monitoringPointId,
        marketId,
        recordedAt,
        aggregate.yes_agents_count,
        aggregate.no_agents_count,
        aggregate.yes_staked_usdc,
        aggregate.no_staked_usdc,
        aggregate.total_agents_count,
        aggregate.total_staked_usdc,
      ],
    );

    return {
      ...aggregate,
      recorded_at: recordedAt,
    };
  }

  private async getOnchainSignatureStatus(
    txSig: string,
  ): Promise<OnchainSignatureStatus | null> {
    if (!this.onchainService) {
      return null;
    }

    try {
      return await this.onchainService.getSignatureStatus(txSig);
    } catch {
      return null;
    }
  }

  private async assertStakeSyncReady(input: {
    actorWalletAddress: string;
    expectedDecisionSide: string;
    marketOnchainPubkey: string | null;
    onchainCommitmentRef: string;
    onchainPositionRef: string;
    requireCommitmentAccount: boolean;
    submittedStakeAmountBaseUnits: string;
    submittedStakeUsdc: string;
    txSig: string | null;
  }) {
    if (!this.onchainService) {
      if (!input.txSig) {
        throw new HttpError(
          400,
          "ONCHAIN_SIGNATURE_REQUIRED",
          "tx_sig is required when the on-chain client is not configured.",
        );
      }

      return {
        stakeAmountBaseUnits: input.submittedStakeAmountBaseUnits,
        stakeUsdc: input.submittedStakeUsdc,
      };
    }

    const positionAccount = await this.getVerifiedOnchainPosition(input);
    if (positionAccount) {
      const stakeAmountBaseUnits = BigInt(
        positionAccount.stake_amount_base_units,
      );

      return {
        stakeAmountBaseUnits: stakeAmountBaseUnits.toString(),
        stakeUsdc: this.formatStakeBaseUnits(stakeAmountBaseUnits),
      };
    }

    throw new HttpError(
      409,
      "ONCHAIN_TX_NOT_FOUND",
      "No confirmed on-chain stake state was found for this position yet.",
    );
  }

  private async resolveStakeTransactionSignature(input: {
    txSig: string | null;
    onchainCommitmentRef: string;
    onchainPositionRef: string;
    requireCommitmentAccount: boolean;
  }) {
    if (input.txSig || !this.onchainService) {
      return input.txSig;
    }

    const [positionSignature, commitmentSignature] = await Promise.all([
      this.findSuccessfulSignatureForAddress(input.onchainPositionRef),
      input.requireCommitmentAccount
        ? this.findSuccessfulSignatureForAddress(input.onchainCommitmentRef)
        : Promise.resolve(null),
    ]);

    return positionSignature ?? commitmentSignature;
  }

  private async findSuccessfulSignatureForAddress(accountAddress: string) {
    if (!this.onchainService) {
      return null;
    }

    try {
      const signature =
        await this.onchainService.findSuccessfulSignatureForAddress(
          accountAddress,
        );
      return signature ? this.assertValidSolanaSignature(signature) : null;
    } catch {
      return null;
    }
  }

  private assertStakeSyncRefsMatchExpected(input: {
    actorWalletAddress: string;
    marketAgent: StakeMarketAgentRow;
    marketOnchainPubkey: string | null;
    onchainCommitmentRef: string;
    onchainPositionRef: string;
  }) {
    if (!this.onchainService || !input.marketOnchainPubkey) {
      return;
    }

    const expectedCommitmentRef =
      input.marketAgent.onchain_commitment_ref ??
      (input.marketAgent.owner_wallet_address
        ? this.onchainService.deriveAgentCommitmentPda(
            input.marketOnchainPubkey,
            input.marketAgent.owner_wallet_address,
          )
        : null);

    if (
      expectedCommitmentRef &&
      expectedCommitmentRef !== input.onchainCommitmentRef
    ) {
      throw new HttpError(
        400,
        "COMMITMENT_REF_MISMATCH",
        "onchain_commitment_ref does not match the selected market agent commitment.",
      );
    }

    const expectedPositionRef = this.onchainService.derivePositionPda(
      input.marketOnchainPubkey,
      input.actorWalletAddress,
      input.onchainCommitmentRef,
    );

    if (expectedPositionRef !== input.onchainPositionRef) {
      throw new HttpError(
        400,
        "POSITION_REF_MISMATCH",
        "onchain_position_ref does not match the expected user position account.",
      );
    }
  }

  private async getVerifiedOnchainPosition(input: {
    actorWalletAddress: string;
    expectedDecisionSide: string;
    marketOnchainPubkey: string | null;
    onchainCommitmentRef: string;
    onchainPositionRef: string;
    requireCommitmentAccount: boolean;
  }): Promise<OnchainPositionAccount | null> {
    if (!this.onchainService || !input.marketOnchainPubkey) {
      return null;
    }

    const positionAccount = await this.onchainService.getPosition(
      input.onchainPositionRef,
    );
    if (!positionAccount) {
      return null;
    }

    if (positionAccount.market !== input.marketOnchainPubkey) {
      throw new HttpError(
        409,
        "ONCHAIN_POSITION_MARKET_MISMATCH",
        "The on-chain position belongs to a different market.",
      );
    }

    if (positionAccount.user !== input.actorWalletAddress) {
      throw new HttpError(
        403,
        "ONCHAIN_POSITION_OWNER_MISMATCH",
        "The on-chain position belongs to a different wallet.",
      );
    }

    if (positionAccount.agent_commitment !== input.onchainCommitmentRef) {
      throw new HttpError(
        409,
        "ONCHAIN_POSITION_COMMITMENT_MISMATCH",
        "The on-chain position is tied to a different AI commitment.",
      );
    }

    if (input.requireCommitmentAccount && !positionAccount.agent_commitment) {
      throw new HttpError(
        409,
        "ONCHAIN_COMMITMENT_NOT_FOUND",
        "The expected on-chain AI commitment was not found yet.",
      );
    }

    if (positionAccount.side !== input.expectedDecisionSide) {
      throw new HttpError(
        409,
        "ONCHAIN_POSITION_SIDE_MISMATCH",
        "The on-chain position side does not match the AI decision.",
      );
    }

    if (positionAccount.status !== "OPEN") {
      throw new HttpError(
        409,
        "ONCHAIN_POSITION_NOT_OPEN",
        "The on-chain position is no longer open.",
      );
    }

    if (BigInt(positionAccount.stake_amount_base_units) <= 0n) {
      throw new HttpError(
        409,
        "ONCHAIN_POSITION_EMPTY",
        "The on-chain position does not hold any stake yet.",
      );
    }

    return positionAccount;
  }

  private normalizePositiveDecimal(value: string, field: string) {
    const normalized = value.trim();
    if (!/^\d+(\.\d+)?$/.test(normalized) || this.isZeroDecimal(normalized)) {
      throw new HttpError(
        400,
        "INVALID_STAKE_AMOUNT",
        `${field} must be greater than zero.`,
      );
    }

    return normalized;
  }

  private normalizePositiveInteger(value: string, field: string) {
    const normalized = value.trim();
    if (!/^\d+$/.test(normalized) || BigInt(normalized) <= 0n) {
      throw new HttpError(
        400,
        "INVALID_STAKE_AMOUNT",
        `${field} must be greater than zero.`,
      );
    }

    return normalized;
  }

  private formatStakeBaseUnits(units: bigint) {
    const wholePart = units / STAKE_BASE_UNIT_SCALE;
    const fractionalPart = (units % STAKE_BASE_UNIT_SCALE)
      .toString()
      .padStart(Number(STAKE_BASE_UNIT_DECIMALS), "0")
      .replace(/0+$/, "");

    return fractionalPart
      ? `${wholePart.toString()}.${fractionalPart}`
      : `${wholePart.toString()}`;
  }

  private assertStakeablePredictionSide(
    value: string | null | undefined,
    message: string,
  ): "YES" | "NO" {
    const normalized = value?.trim().toUpperCase();

    if (normalized === "YES" || normalized === "NO") {
      return normalized;
    }

    throw new HttpError(409, "AGENT_DECISION_NOT_STAKEABLE", message);
  }

  private assertValidSolanaPublicKey(
    value: string | null | undefined,
    field: string,
  ) {
    const normalized = value?.trim();
    if (!normalized || !this.onchainService?.isValidPublicKey(normalized)) {
      throw new HttpError(
        400,
        "INVALID_SOLANA_PUBLIC_KEY",
        `${field} must be a valid Solana public key.`,
      );
    }

    return normalized;
  }

  private assertValidSolanaSignature(value: string) {
    const normalized = value.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,128}$/.test(normalized)) {
      throw new HttpError(
        400,
        "INVALID_ONCHAIN_SIGNATURE",
        "tx_sig must be a valid Solana transaction signature.",
      );
    }

    return normalized;
  }

  private isZeroDecimal(value: string) {
    return value.replace(".", "").replace(/^0+/, "") === "";
  }

  private async insertPromptArtifact(
    client: PoolClient,
    input: {
      id: string;
      uri: string;
      artifactHash: string;
      canonicalizationVersion: string;
      payload: unknown;
    },
  ) {
    await client.query(
      `
        INSERT INTO prompt_artifacts (
          id, artifact_uri, artifact_hash, hash_algo, canonicalization_version,
          is_public, published_at, payload_json, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8::jsonb, now(), now()
        )
        ON CONFLICT (id) DO NOTHING
      `,
      [
        input.id,
        input.uri,
        input.artifactHash,
        "sha256",
        input.canonicalizationVersion,
        false,
        new Date().toISOString(),
        JSON.stringify(input.payload),
      ],
    );
  }
}
