// Pure mapping from a Stellar RPC event to the rows the indexer stores. No I/O here, so the
// shapes the treasury and registry contracts publish are pinned by tests, not by hope.
import { scValToNative, xdr } from "@stellar/stellar-base";

/** The subset of an RPC `getEvents` entry the indexer reads. */
export interface RpcEvent {
  id: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  contractId: string;
  topic: string[]; // base64 XDR ScVal
  value: string; // base64 XDR ScVal
}

export interface EventRow {
  id: string;
  network: string;
  ledger: number;
  closed_at: string;
  tx_hash: string;
  contract_id: string;
  kind: string;
  counterparty: string | null;
  amount: string | null;
  detail: Record<string, unknown> | null;
}

export interface Registration {
  network: string;
  treasury_id: string;
  owner: string;
  registered_at: string;
}

/** Treasury event topics the indexer keeps (contracts/treasury/src/lib.rs `publish` calls). */
export const TREASURY_KINDS = [
  "paid",
  "session",
  "revoked",
  "withdrawn",
  "limits",
  "escrowed",
  "released",
  "refunded",
  "cancelled",
  "payee_add",
  "payee_rm",
  "paused",
  "agent",
  "rep_gate",
  "wl_root",
  // v4
  "deposit",
  "monthly",
  "payee_cap",
  "budget",
] as const;

const decode = (b64: string): unknown => scValToNative(xdr.ScVal.fromXDR(b64, "base64"));

export const symbolTopic = (name: string): string => xdr.ScVal.scvSymbol(name).toXDR("base64");

const str = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));

const hex = (v: unknown): string => {
  if (v instanceof Uint8Array) {
    return Array.from(v, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return String(v ?? "");
};

/** The registry's `regd` event: topics (regd, owner), value treasury. Null for anything else. */
export function toRegistration(e: RpcEvent, network: string): Registration | null {
  const topics = e.topic.map(decode);
  if (String(topics[0]) !== "regd") return null;
  return {
    network,
    treasury_id: String(decode(e.value)),
    owner: String(topics[1]),
    registered_at: e.ledgerClosedAt,
  };
}

/** A treasury event as a stored row. Payloads are tuples whose first element is the address
 *  the event is about and, where present, the second is the amount — except `session`
 *  (agent, valid_until, limit), `limits` (daily, per_task), `paused` (bool), `wl_root`
 *  (BytesN<32>), and the v4 events, which put their address in the second topic: `deposit`
 *  (from) -> amount, `payee_cap` (payee) -> cap, `budget` (agent) -> (valid_until, limit,
 *  payees), and `monthly` -> limit. */
export function toEventRow(e: RpcEvent, network: string): EventRow {
  const kind = String(decode(e.topic[0]));
  const value = decode(e.value);
  const tuple = Array.isArray(value) ? value : [value];
  let counterparty: string | null = null;
  let amount: string | null = null;
  let detail: Record<string, unknown> | null = null;
  switch (kind) {
    case "session":
      counterparty = str(tuple[0]);
      amount = str(tuple[2]);
      break;
    case "limits":
      amount = str(tuple[0]); // daily limit
      detail = { per_task: str(tuple[1]) };
      break;
    case "monthly":
      amount = str(tuple[0]);
      break;
    case "deposit":
    case "payee_cap":
      counterparty = e.topic[1] ? str(decode(e.topic[1])) : null;
      amount = str(tuple[0]);
      break;
    case "budget":
      counterparty = e.topic[1] ? str(decode(e.topic[1])) : null;
      amount = str(tuple[1]); // the budget's cap
      detail = {
        valid_until: Number(tuple[0]),
        payees: Array.isArray(tuple[2]) ? tuple[2].map(String) : [],
      };
      break;
    case "paused":
      detail = { paused: Boolean(tuple[0]) };
      break;
    case "wl_root":
      detail = { root: hex(tuple[0]) };
      break;
    case "revoked":
      break;
    default:
      counterparty = str(tuple[0]);
      amount = typeof tuple[1] === "bigint" || typeof tuple[1] === "number" ? String(tuple[1]) : null;
  }
  return {
    id: e.id,
    network,
    ledger: e.ledger,
    closed_at: e.ledgerClosedAt,
    tx_hash: e.txHash,
    contract_id: e.contractId,
    kind,
    counterparty,
    amount,
    detail,
  };
}
