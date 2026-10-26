// Best-effort telemetry: record each user's on-chain interaction (treasury deploy, fund,
// whitelist, pay, or a policy-rejected pay) so real usage is provable — this is the evidence
// backbone for Level 4's "10+ user wallet interactions". Logging never blocks the UX.
import { supabase, supabaseConfigured } from "./supabase";
import type { FeedEvent } from "./events";

/** Every verb the app can log. The database's CHECK allowlist
 *  (supabase/migrations/0005_activity_action_verbs.sql) must carry the same set —
 *  activity.migration.test.ts holds the two together. */
export const ACTIVITY_ACTIONS = [
  "deploy",
  "fund",
  "whitelist",
  "pay",
  "reject",
  "pause",
  "withdraw",
  "limits",
  "session_start",
  "session_revoke",
  "agent_pay",
  "register",
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface ActivityInput {
  walletAddress: string;
  treasuryId?: string;
  action: ActivityAction;
  txHash?: string;
  amountXlm?: number;
}

/** Shape + clamp an activity row to the table's column limits (pure, testable). */
export function buildActivityRow(input: ActivityInput) {
  return {
    wallet_address: input.walletAddress.slice(0, 64),
    treasury_id: input.treasuryId ? input.treasuryId.slice(0, 64) : null,
    action: input.action,
    tx_hash: input.txHash ? input.txHash.slice(0, 80) : null,
    amount_xlm: input.amountXlm ?? null,
  };
}

export async function logActivity(input: ActivityInput): Promise<void> {
  if (!supabaseConfigured || !supabase || !input.walletAddress) return;
  try {
    // supabase-js resolves with { error } rather than throwing, so a rejected row (a CHECK
    // constraint, a unique index) would otherwise pass the catch below without a trace.
    const { error } = await supabase.from("activity").insert(buildActivityRow(input));
    if (error) console.error("[eunomia] activity log failed:", error.message);
  } catch (e) {
    // best-effort — a logging failure must never break the user's action
    console.error("[eunomia] activity log failed:", e instanceof Error ? e.message : e);
  }
}

// ---- platform activity feed (full history + live) -------------------------------
// The RPC only retains a bounded event window, so the Activity view's full history
// comes from this table (every logged action, platform-wide) and the live layer from
// a Realtime INSERT subscription — the RPC poll stays for on-chain event detail.

export interface ActivityRow {
  id: number;
  wallet_address: string;
  treasury_id: string | null;
  action: string;
  tx_hash: string | null;
  amount_xlm: number | string | null;
  created_at: string;
}

export interface ChainEventRow {
  id: string;
  network?: string;
  ledger?: number;
  closed_at: string;
  tx_hash: string;
  contract_id: string;
  kind: string;
  counterparty: string | null;
  /** Raw 7-decimal token units (stroops) as stored by workers/chain-indexer. */
  amount: number | string | null;
}

const shortAddr = (a: string) => (a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

/** Map a platform activity row to a feed item (pure, testable). */
export function activityToFeedEvent(row: ActivityRow): FeedEvent {
  const who = shortAddr(row.wallet_address);
  const amt = row.amount_xlm == null ? null : Number(row.amount_xlm);
  const amtTxt = amt != null && !Number.isNaN(amt) ? ` · ${amt} XLM` : "";
  const map: Record<string, { kind: string; label: string }> = {
    deploy: { kind: "deploy", label: `${who} created a treasury` },
    fund: { kind: "fund", label: `${who} funded a treasury${amtTxt}` },
    whitelist: { kind: "whitelist", label: `${who} approved a payee` },
    pay: { kind: "paid", label: `Payment from ${who}'s treasury${amtTxt}` },
    agent_pay: { kind: "paid", label: `Leash-signed agent payment · ${who}${amtTxt}` },
    reject: { kind: "blocked", label: `Payment blocked by ${who}'s rules${amtTxt}` },
    session_start: { kind: "leash", label: `${who} started a Leash` },
    session_revoke: { kind: "leash", label: `${who} revoked a Leash` },
    pause: { kind: "lifecycle", label: `${who} paused their treasury` },
    withdraw: { kind: "lifecycle", label: `${who} withdrew from their treasury` },
    limits: { kind: "lifecycle", label: `${who} updated treasury limits` },
    register: { kind: "lifecycle", label: `${who} backed up their treasury` },
  };
  const m = map[row.action] ?? { kind: row.action, label: `${who} · ${row.action}` };
  return {
    id: `sb-${row.id}`,
    kind: m.kind,
    label: m.label,
    txHash: row.tx_hash ?? "",
    at: row.created_at,
    amountXlm: amt != null && !Number.isNaN(amt) ? amt : undefined,
    treasuryId: row.treasury_id ?? undefined,
  };
}

/** Map an indexed `chain_events` row to a `FeedEvent` (pure, testable). */
export function chainEventToFeedEvent(row: ChainEventRow): FeedEvent {
  const who = row.counterparty ? shortAddr(row.counterparty) : "treasury";
  const rawAmt = row.amount == null ? null : Number(row.amount);
  const amt = rawAmt != null && !Number.isNaN(rawAmt) ? rawAmt / 1e7 : null;
  const amtTxt = amt != null ? ` · ${amt} XLM` : "";

  const map: Record<string, { kind: string; label: string; payee?: string }> = {
    paid: {
      kind: "paid",
      label: amt != null ? `Agent paid ${amt} XLM to ${who}` : `Agent paid ${who}`,
    },
    deposit: {
      kind: "fund",
      label: `${who} funded a treasury${amtTxt}`,
    },
    payee_add: {
      kind: "whitelist",
      label: `Payee approved: ${who}`,
      payee: row.counterparty ?? undefined,
    },
    payee_rm: {
      kind: "payee_rm",
      label: `Payee removed: ${who}`,
      payee: row.counterparty ?? undefined,
    },
    session: {
      kind: "leash",
      label: `Leash started for ${who}${amtTxt}`,
    },
    budget: {
      kind: "leash",
      label: `Task budget approved for ${who}${amtTxt}`,
    },
    revoked: {
      kind: "revoked",
      label: "Leash revoked",
    },
    withdrawn: {
      kind: "lifecycle",
      label: `Withdrew from treasury to ${who}${amtTxt}`,
    },
    limits: {
      kind: "lifecycle",
      label: `Updated treasury limits${amtTxt}`,
    },
    monthly: {
      kind: "lifecycle",
      label: `Updated monthly limit${amtTxt}`,
    },
    payee_cap: {
      kind: "lifecycle",
      label: `Updated monthly cap for ${who}${amtTxt}`,
    },
    paused: {
      kind: "paused",
      label: "Treasury pause updated",
    },
    agent: {
      kind: "agent",
      label: `Root agent rotated to ${who}`,
    },
    escrowed: {
      kind: "escrowed",
      label: `Escrow opened for ${who}${amtTxt}`,
    },
    released: {
      kind: "released",
      label: `Escrow released to ${who}${amtTxt}`,
    },
    refunded: {
      kind: "refunded",
      label: "Escrow refunded",
    },
    cancelled: {
      kind: "refunded",
      label: "Escrow cancelled by owner",
    },
  };

  const m = map[row.kind] ?? { kind: row.kind, label: `${who} · ${row.kind}${amtTxt}` };
  return {
    id: `ce-${row.id}`,
    kind: m.kind,
    label: m.label,
    txHash: row.tx_hash ?? "",
    at: row.closed_at,
    amountXlm: amt ?? undefined,
    treasuryId: row.contract_id,
    ...(m.payee ? { payee: m.payee } : {}),
  };
}

/** Merge on-chain events (primary — richer labels) with platform rows, newest first.
 *  Duplicates are dropped by tx hash; rows without a hash always survive. Pure. */
export function mergeFeedEvents(primary: FeedEvent[], secondary: FeedEvent[], cap = 120): FeedEvent[] {
  const seen = new Set(primary.map((e) => e.txHash).filter(Boolean));
  const merged = [...primary, ...secondary.filter((e) => !e.txHash || !seen.has(e.txHash))];
  return merged.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, cap);
}

/** Minimal structural shape of a Supabase query builder so unit tests can inject a fake client. */
export interface SupabaseQueryBuilder<T = unknown> {
  select: (cols: string) => SupabaseQueryBuilder<T>;
  eq: (col: string, val: string) => SupabaseQueryBuilder<T>;
  order: (col: string, opts: { ascending: boolean }) => SupabaseQueryBuilder<T>;
  limit: (n: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>;
  range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>;
}

export interface SupabaseReadClient {
  from: (table: string) => SupabaseQueryBuilder;
}

export interface TreasuryHistoryOptions {
  limit?: number;
  offset?: number;
  client?: SupabaseReadClient | null;
  configured?: boolean;
}

/** Full platform history, newest first (empty when Supabase isn't configured).
 *  Throws when the query fails so callers can render an explicit error state. */
export async function fetchActivityHistory(
  limit = 120,
  opts?: TreasuryHistoryOptions,
): Promise<FeedEvent[]> {
  const configured = opts?.configured ?? supabaseConfigured;
  const client = (opts?.client !== undefined ? opts.client : supabase) as SupabaseReadClient | null;
  if (!configured || !client) return [];

  const offset = Math.max(0, opts?.offset ?? 0);
  const query = client
    .from("activity")
    .select("id,wallet_address,treasury_id,action,tx_hash,amount_xlm,created_at")
    .order("created_at", { ascending: false });

  const { data, error } =
    offset > 0
      ? await query.range(offset, offset + limit - 1)
      : await query.limit(limit);

  if (error) {
    throw new Error(error.message || "Could not load activity history.");
  }
  if (!data) return [];
  return (data as ActivityRow[]).map(activityToFeedEvent);
}

/** Per-treasury history read server-side from `chain_events_public` (and off-chain `activity`
 *  rows for this treasury), with pagination (`limit` + `offset`).
 *
 *  Because filtering happens server-side by `contract_id` / `treasury_id`, an older treasury's
 *  history remains visible no matter how many newer platform-wide rows arrive. Throws on
 *  fetch errors instead of returning `[]`. */
export async function fetchTreasuryHistory(
  treasuryId: string,
  opts?: TreasuryHistoryOptions,
): Promise<FeedEvent[]> {
  if (!treasuryId) return [];
  const configured = opts?.configured ?? supabaseConfigured;
  const client = (opts?.client !== undefined ? opts.client : supabase) as SupabaseReadClient | null;
  if (!configured || !client) return [];

  const limit = Math.max(1, opts?.limit ?? 50);
  const offset = Math.max(0, opts?.offset ?? 0);
  const from = offset;
  const to = offset + limit - 1;

  const [chainRes, activityRes] = await Promise.all([
    client
      .from("chain_events_public")
      .select("id,closed_at,tx_hash,contract_id,kind,counterparty,amount")
      .eq("contract_id", treasuryId)
      .order("closed_at", { ascending: false })
      .range(from, to),
    client
      .from("activity")
      .select("id,wallet_address,treasury_id,action,tx_hash,amount_xlm,created_at")
      .eq("treasury_id", treasuryId)
      .order("created_at", { ascending: false })
      .range(from, to),
  ]);

  if (chainRes.error) {
    throw new Error(chainRes.error.message || "Could not load treasury history.");
  }
  if (activityRes.error) {
    throw new Error(activityRes.error.message || "Could not load treasury history.");
  }

  const chainEvents = ((chainRes.data ?? []) as ChainEventRow[]).map(chainEventToFeedEvent);
  const activityEvents = ((activityRes.data ?? []) as ActivityRow[]).map(activityToFeedEvent);
  return mergeFeedEvents(chainEvents, activityEvents, offset + limit);
}

/** Live INSERT stream — returns an unsubscribe. No-op when Supabase isn't configured. */
export function subscribeActivity(onEvent: (e: FeedEvent) => void): () => void {
  if (!supabaseConfigured || !supabase) return () => {};
  const sb = supabase; // narrow once — the guard doesn't carry into the closure below
  const ch = sb
    .channel("activity-live")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity" }, (payload) => {
      try {
        onEvent(activityToFeedEvent(payload.new as ActivityRow));
      } catch {
        /* malformed row — skip */
      }
    })
    .subscribe();
  return () => {
    try {
      void sb.removeChannel(ch);
    } catch {
      /* already gone */
    }
  };
}
