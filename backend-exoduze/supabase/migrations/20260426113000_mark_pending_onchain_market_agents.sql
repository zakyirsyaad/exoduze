update market_agents ma
set status = 'pending_onchain',
    updated_at = now()
from agent_commitments ac
where ac.market_agent_id = ma.id
  and ma.status = 'active'
  and nullif(ac.onchain_commitment_ref, '') is null;

update market_agents ma
set status = 'pending_onchain',
    updated_at = now()
where ma.status = 'active'
  and not exists (
    select 1
    from agent_commitments ac
    where ac.market_agent_id = ma.id
  );
