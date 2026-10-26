// The treasury contract exposes no payee enumeration (only `is_payee`), but it emits
// `payee_add` / `payee_rm` events carrying the address — so the payee list is derived by
// folding those events (persisted per-treasury by eventLedger), unioned with a device-local
// "book" of addresses this browser whitelisted (covers events older than RPC retention).
// The chain stays the source of truth: rows can be verified on demand via `is_payee`.
import type { FeedEvent } from "./events";

export interface PayeeEntry {
  address: string;
  addedAt?: string;
  source: "chain" | "local";
}

/** Sort key: TOID-style event ids ("<toid>-<idx>") compare chronologically as bigints;
 *  anything unparsable sorts first (stable, harmless — it can only be a non-payee event). */
function idOrder(a: FeedEvent, b: FeedEvent): number {
  const num = (e: FeedEvent) => {
    const t = e.id.split("-")[0];
    return /^\d+$/.test(t) ? BigInt(t) : 0n;
  };
  const d = num(a) - num(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

/** Fold payee_add/payee_rm events (any input order) into the current whitelist. */
export function payeesFromEvents(events: FeedEvent[]): PayeeEntry[] {
  const current = new Map<string, PayeeEntry>();
  for (const e of [...events].sort(idOrder)) {
    if (!e.payee) continue;
    if (e.kind === "payee_add") {
      current.set(e.payee, { address: e.payee, addedAt: e.at, source: "chain" });
    } else if (e.kind === "payee_rm") {
      current.delete(e.payee);
    }
  }
  return [...current.values()];
}

/** Chain-derived entries win; local book addresses not seen on-chain append as "local". */
export function mergePayees(chain: PayeeEntry[], local: string[]): PayeeEntry[] {
  const seen = new Set(chain.map((p) => p.address));
  return [
    ...chain,
    ...local.filter((a) => !seen.has(a)).map((address): PayeeEntry => ({ address, source: "local" })),
  ];
}

// ---- device-local payee book ------------------------------------------------------

const BOOK_PREFIX = "prism_payees:";

export function loadPayeeBook(treasuryId: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(BOOK_PREFIX + treasuryId);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((a): a is string => typeof a === "string") : [];
  } catch {
    return [];
  }
}

export function rememberPayee(treasuryId: string, addr: string): void {
  if (typeof localStorage === "undefined") return;
  const list = loadPayeeBook(treasuryId);
  if (!list.includes(addr)) {
    localStorage.setItem(BOOK_PREFIX + treasuryId, JSON.stringify([...list, addr]));
  }
}

export function forgetPayee(treasuryId: string, addr: string): void {
  if (typeof localStorage === "undefined") return;
  const list = loadPayeeBook(treasuryId).filter((a) => a !== addr);
  localStorage.setItem(BOOK_PREFIX + treasuryId, JSON.stringify(list));
}

// ---- device-local capped payee book (v4) ------------------------------------------
// A monthly cap can be set on any address (including the agent's own float address, before or
// without whitelisting it). Remembering addresses capped from Settings lets the payee caps
// table list them alongside approved payees and on-chain `payee_cap` events.

const CAP_BOOK_PREFIX = "prism_payee_caps:";

export function cappedPayeesFromEvents(events: FeedEvent[]): string[] {
  const seen = new Set<string>();
  for (const e of [...events].sort(idOrder)) {
    if (e.kind === "payee_cap" && e.payee) {
      if (e.amountXlm !== undefined && e.amountXlm <= 0) seen.delete(e.payee);
      else seen.add(e.payee);
    }
  }
  return [...seen];
}

export function loadCappedPayeeBook(treasuryId: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CAP_BOOK_PREFIX + treasuryId);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((a): a is string => typeof a === "string") : [];
  } catch {
    return [];
  }
}

export function rememberCappedPayee(treasuryId: string, addr: string): void {
  if (typeof localStorage === "undefined") return;
  const list = loadCappedPayeeBook(treasuryId);
  if (!list.includes(addr)) {
    localStorage.setItem(CAP_BOOK_PREFIX + treasuryId, JSON.stringify([...list, addr]));
  }
}

export function forgetCappedPayee(treasuryId: string, addr: string): void {
  if (typeof localStorage === "undefined") return;
  const list = loadCappedPayeeBook(treasuryId).filter((a) => a !== addr);
  localStorage.setItem(CAP_BOOK_PREFIX + treasuryId, JSON.stringify(list));
}
