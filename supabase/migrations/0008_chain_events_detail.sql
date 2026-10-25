-- Extra structured fields for treasury events whose full payload does not fit into
-- `(counterparty, amount)`: `paused` direction (`{ "paused": true | false }`), `limits`
-- per-task limit (`{ "per_task": "..." }`), `budget` expiry and payees
-- (`{ "valid_until": ..., "payees": [...] }`), and `wl_root` Merkle root (`{ "root": "..." }`).

alter table public.chain_events
  add column if not exists detail jsonb;
