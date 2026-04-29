alter table agent_market_decisions
  add column if not exists key_signals jsonb not null default '[]'::jsonb,
  add column if not exists risk_factors jsonb not null default '[]'::jsonb;
