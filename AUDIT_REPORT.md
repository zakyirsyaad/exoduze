# Project Readiness Audit Report

## Executive Summary

- Overall readiness score for staging: 3/10
- Overall readiness score for production: 2/10
- Main risks: broken admin/dispute/cron flows, mock-only AI battle decisions, unsafe autonomous resolution finalization, payout/accounting mismatch with the smart contract, weak payout claim verification, permissive security defaults, missing production operations.
- Fastest path to staging: restore or safely gate admin/dispute/cron flows, disable unsafe autonomous settlement defaults, make resolution finalization recoverable, align payout math with the contract, verify payout claims against on-chain position state, fix lint blockers, and harden CORS/rate-limit/env defaults.
- Fastest path to production: add database privilege/RLS hardening, distributed worker locking, dependency upgrades, chain/environment validation, monitoring, alerting, CI/CD, and end-to-end transaction tests.

## Severity Findings

### BLOCKER

#### Admin market, dispute, and cron UIs call missing APIs

- Severity: BLOCKER
- Area: Backend/API, Frontend
- Evidence: `frontend-exoduze/lib/admin-client.ts` calls market CRUD, publish, resolve, dispute, and cron endpoints. `backend-exoduze/src/routes/market.routes.ts` only exposes public market list/detail/news, live websocket, join, stake, and snapshots. No Next `app/**/route.ts` handlers exist for `/api/cron/*`.
- Why it matters: staging admin workflows return 404 and cannot operate market lifecycle or disputes.
- Recommended fix: implement protected backend endpoints using existing services, or hide/disable the UI paths until backend support exists.
- Exact files likely involved: `backend-exoduze/src/routes/market.routes.ts`, `backend-exoduze/src/app.ts`, `frontend-exoduze/lib/admin-client.ts`, `frontend-exoduze/components/admin/*`.
- Risk if ignored: admin users cannot create, edit, publish, resolve, or dispute markets in staging.

#### Public dispute submission is frontend-only

- Severity: BLOCKER
- Area: Market resolution, Backend/API
- Evidence: `frontend-exoduze/components/markets/ResolutionPanel.tsx` posts to `/v1/markets/:slug/resolutions/:resolutionId/dispute`, but no backend route handles it.
- Why it matters: users cannot challenge automatic oracle proposals.
- Recommended fix: add authenticated dispute-create route plus admin list/accept/reject routes.
- Exact files likely involved: `backend-exoduze/src/routes/market.routes.ts`, `backend-exoduze/src/modules/markets/markets.service.ts`.
- Risk if ignored: automatic resolutions become effectively uncontestable.

#### Battle AI is mock-only

- Severity: BLOCKER
- Area: AI/Agent logic
- Evidence: `backend-exoduze/src/modules/ai/battle-prediction.service.ts` always calls `generateMockPrediction()` and returns provider `mock`, even when env says `AI_DECISION_PROVIDER=openai`.
- Why it matters: AI battle decisions are deterministic placeholders, not real provider-backed decisions.
- Recommended fix: wire battle joins to a real provider path with strict schema validation, or explicitly gate staging as mock-only.
- Exact files likely involved: `backend-exoduze/src/modules/ai/battle-prediction.service.ts`, `backend-exoduze/src/modules/ai/ai-market-join.service.ts`, `backend-exoduze/ai-exoduze/index.js`.
- Risk if ignored: markets are driven by placeholder logic and users may trust fake model decisions.

#### Finalizer can corrupt resolution state

- Severity: BLOCKER
- Area: Market resolution, Web3
- Evidence: `backend-exoduze/src/modules/markets/resolution-finalizer.ts` updates `market_resolutions` to `finalized`, commits, then resolves on-chain and settles the DB market.
- Why it matters: if on-chain resolve or DB settlement fails after the commit, the system can store a finalized proposal while the market remains unresolved.
- Recommended fix: make finalization idempotent and only mark the resolution finalized in the same DB transaction that settles the market after any required on-chain action succeeds.
- Exact files likely involved: `backend-exoduze/src/modules/markets/resolution-finalizer.ts`, `backend-exoduze/src/modules/markets/markets.service.ts`.
- Risk if ignored: market resolution state can diverge across resolution proposal, market status, payouts, and chain state.

#### Local env contains live-looking secrets and dangerous autonomous settings

- Severity: BLOCKER
- Area: Security, DevOps
- Evidence: ignored local env contains database credentials, Supabase service role key, OpenAI/API keys, cron secret, and autonomous publish/resolve enabled with dispute window `0`.
- Why it matters: these values are not tracked, but any shared or leaked local env creates immediate operational risk.
- Recommended fix: rotate any shared credentials, use managed secret storage, document safe staging defaults, and fail closed for dangerous production/staging env combinations.
- Exact files likely involved: `backend-exoduze/.env.example`, deployment secret configuration.
- Risk if ignored: credential compromise or immediate automated settlement without human review.

### CRITICAL

#### Backend payout math does not match the smart contract

- Severity: CRITICAL
- Area: Funds, Smart contract/Web3
- Evidence: backend settlement uses `PAYOUT_TOP_AGENT_BONUS_BPS` in `backend-exoduze/src/modules/markets/markets.service.ts`, while `smartcontract-exoduze/programs/exoduze_prediction_market/src/lib.rs` calculates pure parimutuel payout plus fee only.
- Why it matters: UI/backend claimable amounts can differ from what the contract pays.
- Recommended fix: set the top-agent bonus to `0` unless/until the contract implements the same bonus.
- Exact files likely involved: `backend-exoduze/src/config/env.ts`, `backend-exoduze/src/modules/markets/markets.service.ts`, `backend-exoduze/.env.example`.
- Risk if ignored: user-visible payout accounting is wrong.

#### Claim endpoint trusts any successful transaction signature

- Severity: CRITICAL
- Area: Funds, Backend/API
- Evidence: `backend-exoduze/src/modules/portfolio/portfolio.service.ts` checks only signature status before marking a payout paid/submitted.
- Why it matters: a successful but unrelated transaction can mark a payout paid.
- Recommended fix: verify the expected on-chain position belongs to the wallet and market and is actually claimed before marking a payout paid.
- Exact files likely involved: `backend-exoduze/src/modules/portfolio/portfolio.service.ts`, `backend-exoduze/src/modules/onchain/exoduze-onchain.service.ts`.
- Risk if ignored: portfolio state can falsely show paid claims.

#### In-process autonomous runner is not horizontally safe

- Severity: CRITICAL
- Area: Workers, DevOps
- Evidence: `backend-exoduze/src/modules/markets/autonomous-market-runner.ts` only has an in-memory `running` flag.
- Why it matters: multiple API instances can run the same cycle concurrently.
- Recommended fix: run the worker as a singleton or acquire a database advisory lock/job lease before each cycle.
- Exact files likely involved: `backend-exoduze/src/modules/markets/autonomous-market-runner.ts`, `backend-exoduze/src/app.ts`.
- Risk if ignored: duplicate market publishing, duplicate resolution attempts, and race conditions.

#### CORS, token storage, and rate limiting are not production-ready

- Severity: CRITICAL
- Area: Security
- Evidence: backend CORS uses `origin: true`; frontend stores bearer tokens in `localStorage`; no backend rate limiter was found.
- Why it matters: broad cross-origin access and no throttling increase abuse and session risk.
- Recommended fix: use an origin allowlist, add rate limits, and consider HttpOnly session cookies before production.
- Exact files likely involved: `backend-exoduze/src/app.ts`, `backend-exoduze/src/config/env.ts`, `frontend-exoduze/lib/auth-storage.ts`.
- Risk if ignored: account/session abuse and broad API exposure.

#### Supabase RLS/privilege hardening absent

- Severity: CRITICAL
- Area: Database, Security
- Evidence: migrations create tables but no `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, or privilege revocations.
- Why it matters: if Supabase REST access is exposed, app-level auth can be bypassed.
- Recommended fix: enable RLS or revoke public access and verify Supabase API exposure.
- Exact files likely involved: `backend-exoduze/supabase/migrations/*.sql`.
- Risk if ignored: direct data access outside backend authorization.

#### Dependency audits fail

- Severity: CRITICAL
- Area: Security, Dependencies
- Evidence: frontend production audit reports critical/high vulnerabilities including Next/protobuf/lodash chains; backend production audit reports high `bigint-buffer` and moderate `uuid` issues.
- Why it matters: known vulnerable packages are not production-ready.
- Recommended fix: upgrade Next and wallet/Solana dependency chains, then re-run audits.
- Exact files likely involved: `frontend-exoduze/package.json`, `frontend-exoduze/package-lock.json`, `backend-exoduze/package.json`, `backend-exoduze/pnpm-lock.yaml`.
- Risk if ignored: known dependency vulnerabilities ship to production.

#### Chain/environment separation is fragile

- Severity: CRITICAL
- Area: Web3, DevOps
- Evidence: backend default program id differs from `.env.example`/contract; frontend hardcodes devnet cluster fallback.
- Why it matters: omitted or mismatched env can send transactions to the wrong program/network.
- Recommended fix: require explicit chain/program/mint env for staging/prod and fail closed on mismatch.
- Exact files likely involved: `backend-exoduze/src/config/env.ts`, `frontend-exoduze/config/SolanaProvider.tsx`, `backend-exoduze/.env.example`.
- Risk if ignored: funds or market state can land on the wrong chain/program.

### IMPORTANT

- Frontend lint fails on `app/portfolio/page.tsx`, `components/markets/ResolutionPanel.tsx`, and `lib/battle-config.ts`.
- Follower staking UI/API gates by `decision_cutoff_at`, while the contract rejects after `join_deadline_at`.
- `/health` only returns a static response and does not check DB/RPC/provider readiness.
- Avatar uploads trust MIME type only and do not validate file magic bytes or re-encode images.
- Migration runner has no migration history/checksum and one migration was untracked during audit.
- Feed provider failures fall back silently; autonomous generation can continue from stale data without alerting.
- `AUTONOMOUS_MARKET_MIN_TOPIC_CONFIDENCE` is ineffective for normal hot-topic snapshots because confidence is not stored.
- CI/CD, Docker/deployment config, monitoring, tracing, alerting, and rollback docs are missing.
- Tracked log files should be removed from version control.
- Seed scripts include mock/invalid wallet data and should be separated from staging seed data.

### NICE_TO_HAVE

- Add global SEO metadata.
- Improve mobile spacing on the home page.
- Use `next/image` or document remote image handling.
- Add redirect or rename for `/leaderbord`.
- Remove dead exported transaction stubs once callers are standardized.
- Add accessibility scan and polish empty/error states.

## Implementation Checklist

| Area | Item | Status | Priority | Evidence | Notes |
|---|---|---|---|---|---|
| Frontend | Build/typecheck | Done | High | `npm run typecheck`, `npm run build` passed | Lint still needed fixes |
| Frontend | Admin market/dispute/cron | Missing | BLOCKER | `admin-client.ts` calls unsupported routes | 404 in staging |
| Backend | Public market APIs | Partial | High | list/detail/join/stake/news exist | Admin lifecycle missing |
| Backend | Auth/authz | Partial | High | Wallet/admin guards exist | No rate limits and localStorage token risk |
| Database | Migrations/indexes | Partial | High | SQL migrations present | No RLS/history; migration tracking weak |
| Web3 | Contract core | Partial | Critical | Rust tests pass | Payout parity and env separation unresolved |
| AI | Battle decisioning | Missing | BLOCKER | provider always `mock` | Market-copy AI is better implemented |
| Resolution | Dispute/finalizer | Missing/Unsafe | BLOCKER | routes missing; finalize-before-settle | Highest market integrity risk |
| Security | Secrets/deps/CORS | Partial | Critical | ignored secrets present, audits fail | Rotate and harden before staging |
| DevOps | CI/deploy/rollback | Missing | Critical | no CI/deploy config found | Needed before production |
| Observability | Logs/audits/metrics | Partial | High | Fastify logs only | audit/job tables mostly unused |
| Docs | Setup/deployment/API | Partial | Medium | backend README useful, frontend template | Update after Phase 1 |

## Risk Matrix

| Risk | Likelihood | Impact | Priority |
|---|---:|---:|---:|
| Broken admin/dispute routes | High | High | BLOCKER |
| Payout/claim accounting mismatch | High | Critical | BLOCKER/CRITICAL |
| Autonomous finalizer divergence | Medium | Critical | BLOCKER |
| Secrets/dependency exposure | High | High | CRITICAL |
| Multi-instance runner duplication | Medium | High | CRITICAL |

## File-by-file Findings

- `backend-exoduze/src/modules/markets/resolution-finalizer.ts`: finalizes proposal before on-chain and DB settlement complete.
- `backend-exoduze/src/modules/markets/markets.service.ts`: has market lifecycle methods but routes do not expose them; payout bonus diverges from contract; needs dispute/finalizer-safe settlement helpers.
- `backend-exoduze/src/modules/portfolio/portfolio.service.ts`: claim recording needs on-chain position verification.
- `backend-exoduze/src/modules/ai/battle-prediction.service.ts`: battle prediction provider is mock-only.
- `backend-exoduze/src/routes/market.routes.ts`: missing admin market lifecycle and dispute routes.
- `backend-exoduze/src/app.ts`: CORS is allow-all and no rate limit is applied.
- `backend-exoduze/src/config/env.ts`: dangerous defaults around program id and payout bonus; missing CORS/rate-limit/cron env docs.
- `frontend-exoduze/lib/admin-client.ts`: calls endpoints that do not exist.
- `frontend-exoduze/components/markets/ResolutionPanel.tsx`: dispute UI posts to a missing backend route and has a lint dependency issue.
- `frontend-exoduze/components/layouts/markets/Stake.tsx`: staking close check should use join deadline to match the contract.
- `smartcontract-exoduze/programs/exoduze_prediction_market/src/lib.rs`: payout math lacks top-agent bonus; join deadline enforcement is stricter than frontend/backend follower stake checks.
- `backend-exoduze/supabase/migrations/*.sql`: no RLS/policies/grants and missing broader status/check constraints.

## Recommended Phase 1 Implementation Plan

1. Add this audit report to `AUDIT_REPORT.md`.
2. Implement backend admin/dispute/cron routes or disable their UI entry points.
3. Make resolution finalization settle and mark finalized atomically after required on-chain resolve succeeds.
4. Set top-agent bonus default to `0` until contract parity exists.
5. Verify payout claims against expected on-chain position state before marking paid.
6. Align frontend/backend staking checks with the contract join deadline.
7. Add CORS allowlist, minimal rate limiting, cron secret config, and safe env documentation.
8. Fix current frontend lint errors.
9. Re-run backend check/test/build, frontend lint/typecheck/build, and smart contract check/tests.

## Phase 2 Database/RLS Review - 2026-05-01

- Migration inspection found no `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`, `GRANT`, or `REVOKE` statements in `backend-exoduze/supabase/migrations/*.sql`.
- No RLS policies were added in this patch because the backend appears to use direct Postgres service access, and enabling RLS without confirming the deployed DB role/ownership could block core service flows.
- Highest-priority private tables needing explicit RLS or privilege revocation: `wallet_identities`, `role_bindings`, `auth_challenges`, `auth_sessions`, `agent_secret_refs`, `audit_logs`, `job_runs`, `user_positions`, `payouts`, `battle_entries`.
- Market integrity tables needing backend-only writes and carefully scoped reads: `markets`, `market_agents`, `agent_commitments`, `agent_market_decisions`, `oracle_results`, `market_resolutions`, `market_disputes`, `chain_events`, `indexer_cursors`.
- Public/catalog tables that can likely support read-only anon policies after review: `categories`, `topics`, `agents` where `visibility = 'public'`, `agent_categories`, `agent_versions` with public-safe fields only, `market_topics`, `news_sources`, `news_items`, `news_item_topics`, `news_item_markets`, `topic_snapshots`, `hot_topic_snapshots`, `topic_mention_timeseries`, `market_monitoring_points`, `leaderboard_facts`, `leaderboard_agent_snapshots`.
- Recommended next step: decide whether Supabase REST access will be exposed. If yes, add a dedicated migration that revokes anon/authenticated writes by default, enables RLS table-by-table, and adds narrow read/write policies with service-role smoke tests.
