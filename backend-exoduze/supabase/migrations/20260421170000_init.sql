create extension if not exists "pgcrypto";

create table if not exists wallet_identities (
  id text primary key,
  wallet_address text not null unique,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists role_bindings (
  id text primary key,
  wallet_identity_id text not null references wallet_identities(id),
  role text not null,
  granted_by_wallet_id text,
  granted_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auth_challenges (
  id text primary key,
  wallet_address text not null,
  nonce text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists auth_sessions (
  id text primary key,
  wallet_identity_id text not null references wallet_identities(id),
  session_token text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id text primary key,
  slug text not null unique,
  name text not null,
  description text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists topics (
  id text primary key,
  category_id text not null references categories(id),
  slug text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, slug)
);

create table if not exists agents (
  id text primary key,
  slug text not null unique,
  name text not null,
  description text not null,
  owner_wallet_identity_id text references wallet_identities(id),
  status text not null,
  avatar_uri text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_categories (
  id text primary key,
  agent_id text not null references agents(id),
  category_id text not null references categories(id),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, category_id)
);

create table if not exists prompt_artifacts (
  id text primary key,
  artifact_uri text not null,
  artifact_hash text not null,
  hash_algo text not null,
  canonicalization_version text not null,
  is_public boolean not null default true,
  published_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_versions (
  id text primary key,
  agent_id text not null references agents(id),
  version_no integer not null,
  version_label text not null,
  prompt_artifact_id text not null references prompt_artifacts(id),
  model_provider text not null,
  model_name text not null,
  runtime_config_json jsonb not null,
  config_hash text not null,
  version_hash text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, version_no)
);

create table if not exists markets (
  id text primary key,
  slug text not null unique,
  onchain_market_pubkey text,
  title text not null,
  short_description text not null,
  description text not null,
  category_id text not null references categories(id),
  status text not null,
  oracle_source text not null,
  settlement_asset text not null default 'USDC',
  opens_at timestamptz not null,
  decision_cutoff_at timestamptz not null,
  closes_at timestamptz not null,
  resolves_at timestamptz,
  total_liquidity_usdc numeric(38, 12) not null,
  final_liquidity_usdc numeric(38, 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists market_topics (
  id text primary key,
  market_id text not null references markets(id),
  topic_id text not null references topics(id),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market_id, topic_id)
);

create table if not exists market_agents (
  id text primary key,
  market_id text not null references markets(id),
  agent_id text not null references agents(id),
  locked_agent_version_id text not null references agent_versions(id),
  joined_at timestamptz not null,
  status text not null,
  final_decision_side text,
  final_decision_at timestamptz,
  finalized_from_decision_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market_id, agent_id)
);

create table if not exists agent_commitments (
  id text primary key,
  market_agent_id text not null unique references market_agents(id),
  snapshot_uri text not null,
  snapshot_hash text not null,
  hash_algo text not null,
  prompt_hash text not null,
  config_hash text not null,
  commit_tx_sig text,
  onchain_commitment_ref text,
  verification_status text not null,
  committed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_market_decisions (
  id text primary key,
  market_agent_id text not null references market_agents(id),
  sequence_no integer not null,
  decision_side text not null,
  confidence double precision not null,
  reason_summary text not null,
  reason_hash text not null,
  decided_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (market_agent_id, sequence_no)
);

create table if not exists user_positions (
  id text primary key,
  wallet_identity_id text not null references wallet_identities(id),
  market_id text not null references markets(id),
  market_agent_id text not null references market_agents(id),
  stake_usdc numeric(38, 12) not null,
  position_units numeric(38, 12),
  onchain_position_ref text,
  open_tx_sig text,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists oracle_results (
  id text primary key,
  market_id text not null references markets(id),
  outcome text not null,
  oracle_source text not null,
  evidence_uri text,
  submitted_by_wallet_id text references wallet_identities(id),
  submitted_tx_sig text,
  status text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payouts (
  id text primary key,
  wallet_identity_id text not null references wallet_identities(id),
  market_id text not null references markets(id),
  market_agent_id text not null references market_agents(id),
  gross_usdc numeric(38, 12) not null,
  fee_usdc numeric(38, 12) not null,
  net_usdc numeric(38, 12) not null,
  payout_tx_sig text,
  status text not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists market_monitoring_points (
  id text primary key,
  market_id text not null references markets(id),
  recorded_at timestamptz not null,
  yes_agents_count integer not null,
  no_agents_count integer not null,
  yes_staked_usdc numeric(38, 12) not null,
  no_staked_usdc numeric(38, 12) not null,
  total_agents_count integer not null,
  total_staked_usdc numeric(38, 12) not null,
  created_at timestamptz not null default now()
);

create table if not exists leaderboard_facts (
  id text primary key,
  agent_id text not null references agents(id),
  market_id text not null references markets(id),
  category_id text not null references categories(id),
  resolved_at timestamptz not null,
  final_decision_side text not null,
  oracle_outcome text not null,
  was_correct boolean not null,
  follower_staked_usdc numeric(38, 12) not null,
  follower_pnl_usdc numeric(38, 12) not null,
  points double precision not null,
  created_at timestamptz not null default now()
);

create table if not exists leaderboard_agent_snapshots (
  id text primary key,
  window_type text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  agent_id text not null references agents(id),
  rank integer not null,
  resolved_markets integer not null,
  wins integer not null,
  losses integer not null,
  accuracy_pct numeric(12, 4) not null,
  bayesian_accuracy numeric(12, 4) not null,
  current_streak integer not null,
  best_streak integer not null,
  total_staked_usdc numeric(38, 12) not null,
  follower_pnl_usdc numeric(38, 12) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists news_sources (
  id text primary key,
  slug text not null unique,
  name text not null,
  source_type text not null,
  base_url text,
  is_active boolean not null default true,
  reliability_score double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists news_items (
  id text primary key,
  source_id text not null references news_sources(id),
  external_id text,
  title text not null,
  summary text,
  url text not null unique,
  image_uri text,
  published_at timestamptz not null,
  language text,
  category_id text references categories(id),
  sentiment_label text,
  sentiment_score double precision,
  is_breaking boolean not null default false,
  mention_weight double precision not null default 1,
  raw_payload_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists news_item_topics (
  id text primary key,
  news_item_id text not null references news_items(id),
  topic_id text not null references topics(id),
  relevance_score double precision not null default 1,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (news_item_id, topic_id)
);

create table if not exists news_item_markets (
  id text primary key,
  news_item_id text not null references news_items(id),
  market_id text not null references markets(id),
  relevance_score double precision not null default 1,
  created_at timestamptz not null default now(),
  unique (news_item_id, market_id)
);

create table if not exists topic_mention_timeseries (
  id text primary key,
  topic_id text not null references topics(id),
  bucket_start_at timestamptz not null,
  bucket_end_at timestamptz not null,
  bucket_granularity text not null,
  mentions_count integer not null,
  previous_mentions_count integer,
  unique_sources_count integer not null,
  breaking_news_count integer not null,
  weighted_mentions_score double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_id, bucket_start_at, bucket_granularity)
);

create table if not exists hot_topic_snapshots (
  id text primary key,
  category_id text references categories(id),
  topic_id text not null references topics(id),
  window_type text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  mentions_count integer not null,
  previous_mentions_count integer,
  mentions_delta integer not null,
  mentions_delta_pct double precision,
  unique_sources_count integer not null,
  breaking_news_count integer not null,
  heat_score double precision not null,
  trend_direction text not null,
  rank integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_id, window_type, window_end)
);

create table if not exists chain_events (
  id text primary key,
  program_id text not null,
  signature text not null,
  instruction_name text,
  event_type text not null,
  slot bigint not null,
  block_time timestamptz,
  payload_json jsonb not null,
  processing_status text not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists indexer_cursors (
  id text primary key,
  stream_name text not null unique,
  last_observed_slot bigint not null default 0,
  last_finalized_slot bigint not null default 0,
  last_signature text,
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id text primary key,
  actor_type text not null,
  actor_wallet_identity_id text references wallet_identities(id),
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before_json jsonb,
  after_json jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create table if not exists agent_secret_refs (
  id text primary key,
  agent_id text not null references agents(id),
  provider text not null,
  secret_ref text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists job_runs (
  id text primary key,
  job_name text not null,
  status text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  details_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_topics_category_id on topics(category_id);
create index if not exists idx_market_topics_market_id on market_topics(market_id);
create index if not exists idx_market_topics_topic_id on market_topics(topic_id);
create index if not exists idx_market_agents_market_id on market_agents(market_id);
create index if not exists idx_agent_market_decisions_market_agent_id on agent_market_decisions(market_agent_id);
create index if not exists idx_user_positions_market_id on user_positions(market_id);
create index if not exists idx_user_positions_wallet_identity_id on user_positions(wallet_identity_id);
create index if not exists idx_news_items_published_at on news_items(published_at desc);
create index if not exists idx_news_item_topics_topic_id on news_item_topics(topic_id);
create index if not exists idx_news_item_markets_market_id on news_item_markets(market_id);
create index if not exists idx_hot_topic_snapshots_window on hot_topic_snapshots(window_type, window_end desc);
