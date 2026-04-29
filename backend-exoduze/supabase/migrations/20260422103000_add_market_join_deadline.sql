alter table markets
add column if not exists join_deadline_at timestamptz;

update markets
set join_deadline_at = least(
  decision_cutoff_at,
  closes_at,
  coalesce(resolves_at, 'infinity'::timestamptz),
  opens_at
    + least(
      interval '24 hours',
      greatest(interval '6 hours', (coalesce(resolves_at, closes_at) - opens_at) * 0.25)
    )
)
where join_deadline_at is null;

alter table markets
alter column join_deadline_at set not null;

create index if not exists idx_markets_join_deadline_at on markets(join_deadline_at);
