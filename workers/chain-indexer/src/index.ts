// Eunomia chain indexer: on a cron, page Stellar RPC events for the registry and every
// known treasury and write them to Supabase (migration 0006). The RPC keeps ~7 days of
// events, so a stored cursor makes each run continue exactly where the previous one stopped.
// Measures what the app log cannot: payments agents make through eunomia-mcp.
import {
  TREASURY_KINDS,
  symbolTopic,
  toEventRow,
  toRegistration,
  type EventRow,
  type RpcEvent,
} from "./decode";

export interface Env {
  NETWORK: string; // "mainnet" — the label stored with every row
  RPC_URL: string;
  REGISTRY_ID: string;
  SUPABASE_URL: string; // secret
  SUPABASE_SERVICE_ROLE_KEY: string; // secret
}

const PAGE_LIMIT = 500;
// Bounded so one cron invocation stays below the Cloudflare Workers Free plan 50-subrequest
// limit: 3 initial requests (knownTreasuries, loadCursor, getHealth) + 10 pages * up to 4
// requests (getEvents, chain_treasuries, chain_events, chain_cursor) = at most 43 subrequests.
export const MAX_PAGES = 10;

const RPC_MAX_ATTEMPTS = 3;
const RPC_BASE_DELAY_MS = 200;

interface EventsPage {
  events: RpcEvent[];
  cursor?: string;
  latestLedger: number;
}

export interface RunOptions {
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The ledger a getEvents paging cursor points at (TOID's high 32 bits); 0 if unparsable. */
export function cursorLedger(cursor: string | null | undefined): number {
  const toid = String(cursor ?? "").split("-")[0];
  if (!toid || !/^\d+$/.test(toid)) return 0;
  return Number(BigInt(toid) >> 32n);
}

export async function rpc<T>(
  env: Env,
  method: string,
  params: unknown,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<T> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt < RPC_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(RPC_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
    let res: Response;
    try {
      res = await fetch(env.RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      continue;
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200).trim();
      lastErr = new Error(`${method}: HTTP ${res.status}${text ? ` ${text}` : ""}`);
      if (res.status === 429 || res.status >= 500) continue;
      throw lastErr;
    }
    let body: { result?: T; error?: { message: string } };
    try {
      body = (await res.json()) as { result?: T; error?: { message: string } };
    } catch {
      lastErr = new Error(`${method}: invalid JSON response`);
      continue;
    }
    if (body.error || !body.result) {
      throw new Error(`${method}: ${body.error?.message ?? res.status}`);
    }
    return body.result;
  }
  throw lastErr ?? new Error(`${method}: failed after ${RPC_MAX_ATTEMPTS} attempts`);
}

/** Topic filters: the registry's `regd`, and treasury topics from any contract (narrowed to
 *  known treasuries afterwards). RPC allows 5 filters of 5 topic patterns each — with the v4
 *  kinds that is every slot; a further kind needs a second request. */
function filters(env: Env) {
  const any = (names: readonly string[]) => names.map((n) => [symbolTopic(n), "**"]);
  const kinds = [...TREASURY_KINDS];
  return [
    { type: "contract", contractIds: [env.REGISTRY_ID], topics: any(["regd"]) },
    { type: "contract", topics: any(kinds.slice(0, 5)) },
    { type: "contract", topics: any(kinds.slice(5, 10)) },
    { type: "contract", topics: any(kinds.slice(10, 15)) },
    { type: "contract", topics: any(kinds.slice(15)) },
  ];
}

async function db(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`supabase ${path}: ${res.status} ${await res.text()}`);
  return res;
}

const upsert = (env: Env, table: string, rows: object[], conflict: string, ignore = true) =>
  rows.length === 0
    ? Promise.resolve()
    : db(env, `${table}?on_conflict=${conflict}`, {
        method: "POST",
        headers: { prefer: `resolution=${ignore ? "ignore" : "merge"}-duplicates,return=minimal` },
        body: JSON.stringify(rows),
      });

async function knownTreasuries(env: Env): Promise<Set<string>> {
  const res = await db(env, `chain_treasuries?network=eq.${env.NETWORK}&select=treasury_id`);
  const rows = (await res.json()) as { treasury_id: string }[];
  return new Set(rows.map((r) => r.treasury_id));
}

async function loadCursor(env: Env): Promise<string | null> {
  const res = await db(env, `chain_cursor?network=eq.${env.NETWORK}&select=cursor`);
  const rows = (await res.json()) as { cursor: string | null }[];
  return rows[0]?.cursor ?? null;
}

export async function run(
  env: Env,
  options: RunOptions = {},
): Promise<{ pages: number; registrations: number; events: number }> {
  // Set at deploy (wrangler.jsonc). Without them a run would fail somewhere less legible.
  if (!env.RPC_URL || !env.REGISTRY_ID) throw new Error("RPC_URL and REGISTRY_ID must be set");
  const sleep = options.sleep ?? defaultSleep;
  const known = await knownTreasuries(env);
  let cursor = await loadCursor(env);
  const health = await rpc<{ oldestLedger: number }>(env, "getHealth", {}, sleep);
  let startLedger: number | undefined;
  // First run or stale cursor (older than the RPC's ~7-day retention window): fall back to
  // the oldest retained ledger so paging resumes instead of failing permanently.
  if (!cursor || cursorLedger(cursor) <= health.oldestLedger) {
    cursor = null;
    startLedger = health.oldestLedger + 1;
  }

  let pages = 0;
  let registrations = 0;
  let stored = 0;
  let latestLedger = 0;
  for (; pages < MAX_PAGES; pages++) {
    const page = await rpc<EventsPage>(
      env,
      "getEvents",
      {
        ...(cursor ? {} : { startLedger }),
        filters: filters(env),
        pagination: cursor ? { cursor, limit: PAGE_LIMIT } : { limit: PAGE_LIMIT },
      },
      sleep,
    );
    latestLedger = page.latestLedger;

    const regs = page.events.flatMap((e) => {
      if (e.contractId !== env.REGISTRY_ID) return [];
      const r = toRegistration(e, env.NETWORK);
      return r ? [r] : [];
    });
    for (const r of regs) known.add(r.treasury_id);
    // A re-registration fills owner/time on a row seeded from the app log, so merge.
    await upsert(env, "chain_treasuries", regs, "network,treasury_id", false);

    const rows: EventRow[] = page.events
      .filter((e) => e.contractId !== env.REGISTRY_ID && known.has(e.contractId))
      .map((e) => toEventRow(e, env.NETWORK));
    await upsert(env, "chain_events", rows, "network,id");

    registrations += regs.length;
    stored += rows.length;
    const advanced = page.cursor && page.cursor !== cursor;
    if (page.cursor) cursor = page.cursor;
    // Save progress every page, so a failure mid-backlog never re-reads or skips a page.
    await upsert(
      env,
      "chain_cursor",
      [{ network: env.NETWORK, cursor, last_ledger: latestLedger, updated_at: new Date().toISOString() }],
      "network",
      false,
    );
    // A short page is not the end: the RPC scans a bounded ledger range per call. Stop only
    // once the cursor has reached the head (or stopped moving).
    if (!advanced || cursorLedger(cursor) >= latestLedger) break;
  }
  return { pages: Math.min(pages + 1, MAX_PAGES), registrations, events: stored };
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Log, then rethrow: a failed run must show as a failed cron invocation, not a quiet one.
    ctx.waitUntil(
      run(env).then(
        (r) => console.log(JSON.stringify({ ok: true, network: env.NETWORK, ...r })),
        (err: unknown) => {
          console.error(JSON.stringify({ ok: false, network: env.NETWORK, error: String(err) }));
          throw err;
        },
      ),
    );
  },
} satisfies ExportedHandler<Env>;
