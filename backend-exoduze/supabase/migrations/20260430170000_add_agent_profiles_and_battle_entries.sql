alter table if exists agents
  add column if not exists specialization text not null default 'general',
  add column if not exists base_personality text,
  add column if not exists base_strategy text,
  add column if not exists risk_profile text not null default 'balanced',
  add column if not exists data_focus jsonb not null default '[]'::jsonb,
  add column if not exists visibility text not null default 'public';

update agents
set
  base_personality = coalesce(nullif(base_personality, ''), 'Calm, analytical, and disciplined when evaluating market evidence.'),
  base_strategy = coalesce(nullif(base_strategy, ''), 'Blend structured signal analysis with measured conviction and risk control.'),
  data_focus = case
    when jsonb_typeof(coalesce(data_focus, '[]'::jsonb)) = 'array' then coalesce(data_focus, '[]'::jsonb)
    else '[]'::jsonb
  end,
  specialization = case
    when specialization in ('crypto', 'finance', 'sports', 'politics', 'tech', 'general') then specialization
    else 'general'
  end,
  risk_profile = case
    when risk_profile in ('conservative', 'balanced', 'aggressive') then risk_profile
    else 'balanced'
  end,
  visibility = case
    when visibility in ('public', 'private') then visibility
    else 'public'
  end
where true;

insert into categories (
  id,
  slug,
  name,
  description,
  sort_order,
  is_active,
  created_at,
  updated_at
)
values (
  'cat_general',
  'general',
  'General',
  'Generalist agents that blend multiple domains and signal types.',
  0,
  true,
  now(),
  now()
)
on conflict (slug) do nothing;

create table if not exists battle_entries (
  id text primary key,
  market_id text not null references markets(id),
  market_agent_id text unique references market_agents(id),
  agent_id text not null references agents(id),
  wallet_identity_id text not null references wallet_identities(id),
  strategy_preset text not null,
  technical_weight integer not null,
  news_weight integer not null,
  sentiment_weight integer not null,
  macro_weight integer not null,
  onchain_weight integer not null,
  optional_insight text,
  stake_amount numeric(38, 12) not null,
  prediction_json jsonb not null,
  prediction_hash text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists battle_entries_market_id_idx
  on battle_entries (market_id, created_at desc);

create index if not exists battle_entries_agent_id_idx
  on battle_entries (agent_id);

create index if not exists battle_entries_wallet_identity_id_idx
  on battle_entries (wallet_identity_id);
