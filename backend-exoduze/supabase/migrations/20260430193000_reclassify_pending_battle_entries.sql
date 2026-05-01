update battle_entries be
set
  stake_amount = up.stake_usdc,
  status = 'locked',
  updated_at = now()
from user_positions up
where be.market_agent_id = up.market_agent_id
  and be.wallet_identity_id = up.wallet_identity_id
  and be.status = 'submitted'
  and up.status = 'open';

update battle_entries be
set
  status = 'pending_onchain',
  updated_at = now()
from market_agents ma
left join agent_commitments ac on ac.market_agent_id = ma.id
where be.market_agent_id = ma.id
  and be.status = 'submitted'
  and (
    ma.status = 'pending_onchain'
    or coalesce(ac.verification_status, '') in ('pending_onchain', 'submitted')
  )
  and not exists (
    select 1
    from user_positions up
    where up.market_agent_id = be.market_agent_id
      and up.wallet_identity_id = be.wallet_identity_id
      and up.status = 'open'
  );
