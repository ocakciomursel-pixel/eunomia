-- Migration hygiene:
-- 1. Drop the anon INSERT policy on `public.feedback`. The app no longer writes to `feedback`
--    (feedback moved to a Google Form, see FeedbackButton.tsx), so leaving anon INSERT open
--    exposes unnecessary write surface for the bundled publishable key.
-- 2. Validate the `NOT VALID` check constraints introduced in `0003_data_quality_checks.sql`
--    across `public.activity` and `public.feedback`. (`VALIDATE CONSTRAINT` is idempotent on
--    PostgreSQL when a constraint is already marked `convalidated = true`.)

drop policy if exists "anon can insert feedback" on public.feedback;

alter table public.activity validate constraint activity_action_allowed;
alter table public.activity validate constraint activity_wallet_len;
alter table public.activity validate constraint activity_treasury_len;
alter table public.activity validate constraint activity_txhash_len;

alter table public.feedback validate constraint feedback_rating_range;
alter table public.feedback validate constraint feedback_valuable_len;
alter table public.feedback validate constraint feedback_improvement_len;
