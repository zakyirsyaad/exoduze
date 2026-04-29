alter table markets
  add column if not exists created_by_wallet_identity_id text references wallet_identities(id),
  add column if not exists resolver_wallet_identity_id text references wallet_identities(id),
  add column if not exists rules_json jsonb not null default '[]'::jsonb,
  add column if not exists context_json jsonb not null default '{}'::jsonb;

create index if not exists idx_markets_created_by_wallet_identity_id
  on markets(created_by_wallet_identity_id);

create index if not exists idx_markets_resolver_wallet_identity_id
  on markets(resolver_wallet_identity_id);
