-- Expose indexed per-treasury chain events for public read so owner views can query
-- their treasury's full history by contract_id server-side (with pagination) instead of
-- slicing the latest 120 platform-wide activity rows client-side (#43).

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chain_events'
      and policyname = 'chain_events_public_read'
  ) then
    create policy chain_events_public_read on public.chain_events
      for select to anon, authenticated using (true);
  end if;
end $$;

create or replace view public.chain_events_public as
select
  id,
  network,
  ledger,
  closed_at,
  tx_hash,
  contract_id,
  kind,
  counterparty,
  amount
from public.chain_events;

grant select on public.chain_events to anon, authenticated;
grant select on public.chain_events_public to anon, authenticated;

create or replace function public.treasury_chain_events(
  p_contract_id text,
  p_limit integer default 120,
  p_offset integer default 0
)
returns table (
  id text,
  network text,
  ledger integer,
  closed_at timestamptz,
  tx_hash text,
  contract_id text,
  kind text,
  counterparty text,
  amount numeric
)
language sql
stable
security invoker
as $$
  select
    e.id,
    e.network,
    e.ledger,
    e.closed_at,
    e.tx_hash,
    e.contract_id,
    e.kind,
    e.counterparty,
    e.amount
  from public.chain_events e
  where e.contract_id = p_contract_id
  order by e.closed_at desc
  limit greatest(1, least(coalesce(p_limit, 120), 500))
  offset greatest(0, coalesce(p_offset, 0));
$$;

grant execute on function public.treasury_chain_events(text, integer, integer) to anon, authenticated;
