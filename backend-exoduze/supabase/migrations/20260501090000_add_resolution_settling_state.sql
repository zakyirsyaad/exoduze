alter table market_resolutions
  drop constraint if exists market_resolutions_status_check;

alter table market_resolutions
  add constraint market_resolutions_status_check
  check (status in ('proposed', 'settling', 'disputed', 'finalized', 'rejected'));

alter table market_resolutions
  add column if not exists onchain_settlement_tx_sig text,
  add column if not exists onchain_settled_at timestamptz;

drop index if exists idx_market_resolutions_one_active_per_market;

create unique index if not exists idx_market_resolutions_one_active_per_market
  on market_resolutions(market_id)
  where status in ('proposed', 'settling', 'disputed', 'finalized');
