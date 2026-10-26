# Supabase migrations

SQL migrations in [`migrations/`](migrations/) mirror the schema and row-level security posture of the live Supabase project (`public.activity`, `public.feedback`, `public.funnel_events`, `public.chain_treasuries`, `public.chain_events`, `public.chain_cursor`).

## Application order

Already-applied migrations are intentionally **not renamed** so historical references, audit logs, and test paths remain stable. Apply them in this exact order:

1. `0001_feedback_activity.sql` — initial `feedback` and `activity` tables with RLS (`anon` INSERT policies).
2. `0002_funnel_events.sql` — pre-connect funnel telemetry table (`funnel_events`) with bounded check constraints.
3. `0003_activity_public_read_realtime.sql` — public `SELECT` policy (`activity_public_read`) and `supabase_realtime` publication for `activity`.
4. `0003_data_quality_checks.sql` — value and length `CHECK` constraints (`NOT VALID`) on `activity` and `feedback`.
5. `0004_activity_integrity.sql` — server-forced `created_at` trigger, unique `tx_hash` partial index, and StrKey/hex format checks on `activity`.
6. `0005_activity_action_verbs.sql` — replaces `activity_action_allowed` with the full Leash-era verb allowlist (guarded by `web/src/lib/activity.migration.test.ts`).
7. `0006_chain_events.sql` — service-role-only on-chain indexer tables (`chain_treasuries`, `chain_events`, `chain_cursor`) and `chain_weekly` view.
8. `0007_mainnet_reset.sql` — archives testnet rows into `testnet_archive` (revoked from `anon`/`authenticated`) and clears testnet telemetry at mainnet cutover.
9. `0008_migration_hygiene.sql` — drops the retired `"anon can insert feedback"` policy on `public.feedback` and validates all `NOT VALID` check constraints from `0003_data_quality_checks.sql`.

> **Note on the duplicate `0003_` prefix:** Both `0003_activity_public_read_realtime.sql` and `0003_data_quality_checks.sql` were committed with the `0003_` prefix after already being applied to the live database. Lexicographical order (`0003_activity_public_read_realtime.sql` first, `0003_data_quality_checks.sql` second) matches the chronological order in which they were applied; neither touches the other's objects, and neither should be renamed.
