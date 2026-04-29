alter table markets
  add column if not exists cutoff_at timestamptz,
  add column if not exists outcome_type text not null default 'YES_NO',
  add column if not exists resolution_source text,
  add column if not exists required_rank integer not null default 3,
  add column if not exists created_by text not null default 'admin',
  add column if not exists generated_reason text,
  add column if not exists final_outcome text;

update markets
set cutoff_at = decision_cutoff_at
where cutoff_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'markets_required_rank_positive'
  ) then
    alter table markets
      add constraint markets_required_rank_positive
      check (required_rank >= 1) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'markets_outcome_type_check'
  ) then
    alter table markets
      add constraint markets_outcome_type_check
      check (outcome_type in ('YES_NO')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'markets_final_outcome_check'
  ) then
    alter table markets
      add constraint markets_final_outcome_check
      check (final_outcome is null or final_outcome in ('YES', 'NO')) not valid;
  end if;
end $$;

alter table markets validate constraint markets_required_rank_positive;
alter table markets validate constraint markets_outcome_type_check;
alter table markets validate constraint markets_final_outcome_check;

create index if not exists idx_markets_cutoff_at on markets(cutoff_at);
create index if not exists idx_markets_resolution_source on markets(resolution_source);
create index if not exists idx_markets_created_by on markets(created_by);

create table if not exists topic_snapshots (
  id text primary key,
  category text not null,
  generated_at timestamptz not null,
  window_hours integer not null default 24,
  source_count integer not null default 0,
  topics jsonb not null default '[]'::jsonb,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  unique (category, generated_at, window_hours),
  check (category <> ''),
  check (window_hours > 0),
  check (source_count >= 0),
  check (jsonb_typeof(topics) = 'array')
);

create index if not exists idx_topic_snapshots_category_generated_at
  on topic_snapshots(category, generated_at);

create table if not exists market_resolutions (
  id text primary key,
  market_id text not null references markets(id) on delete cascade,
  proposed_outcome text not null check (proposed_outcome in ('YES', 'NO')),
  evidence_snapshot_id text not null references topic_snapshots(id),
  evidence_summary text not null,
  proposed_by text not null check (proposed_by in ('oracle_bot', 'admin')),
  proposed_at timestamptz not null,
  dispute_deadline timestamptz not null,
  status text not null check (status in ('proposed', 'disputed', 'finalized', 'rejected')),
  finalized_outcome text check (finalized_outcome is null or finalized_outcome in ('YES', 'NO')),
  finalized_at timestamptz,
  finalized_by text,
  dispute_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_market_resolutions_market_id
  on market_resolutions(market_id);

create index if not exists idx_market_resolutions_status_deadline
  on market_resolutions(status, dispute_deadline);

create unique index if not exists idx_market_resolutions_one_active_per_market
  on market_resolutions(market_id)
  where status in ('proposed', 'disputed', 'finalized');

create table if not exists market_disputes (
  id text primary key,
  market_id text not null references markets(id) on delete cascade,
  resolution_id text not null references market_resolutions(id) on delete cascade,
  disputed_by text not null,
  reason text not null,
  status text not null check (status in ('open', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);

create index if not exists idx_market_disputes_market_id
  on market_disputes(market_id);

create index if not exists idx_market_disputes_resolution_id
  on market_disputes(resolution_id);

create index if not exists idx_market_disputes_status_created_at
  on market_disputes(status, created_at desc);
