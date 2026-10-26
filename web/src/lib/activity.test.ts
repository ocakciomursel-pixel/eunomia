import { describe, it, expect } from "vitest";
import { buildActivityRow } from "./activity";

describe("buildActivityRow", () => {
  it("maps a full input to the activity row shape", () => {
    expect(
      buildActivityRow({ walletAddress: "GABC", treasuryId: "CXYZ", action: "pay", txHash: "HASH", amountXlm: 5 }),
    ).toEqual({ wallet_address: "GABC", treasury_id: "CXYZ", action: "pay", tx_hash: "HASH", amount_xlm: 5 });
  });

  it("nulls optional fields when absent", () => {
    expect(buildActivityRow({ walletAddress: "GABC", action: "deploy" })).toEqual({
      wallet_address: "GABC",
      treasury_id: null,
      action: "deploy",
      tx_hash: null,
      amount_xlm: null,
    });
  });

  it("clamps overlong values to the column limits", () => {
    const row = buildActivityRow({
      walletAddress: "G".repeat(70),
      treasuryId: "C".repeat(70),
      action: "fund",
      txHash: "H".repeat(90),
    });
    expect(row.wallet_address.length).toBe(64);
    expect(row.treasury_id?.length).toBe(64);
    expect(row.tx_hash?.length).toBe(80);
  });
});

// ---- platform feed mapping + merge ----
import {
  activityToFeedEvent,
  chainEventToFeedEvent,
  fetchActivityHistory,
  fetchTreasuryHistory,
  mergeFeedEvents,
  type ActivityRow,
  type ChainEventRow,
  type SupabaseQueryBuilder,
  type SupabaseReadClient,
} from "./activity";
import type { FeedEvent } from "./events";

const row = (over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: 1,
  wallet_address: "GAJDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXNK46",
  treasury_id: "CTREASURY",
  action: "pay",
  tx_hash: "abc123",
  amount_xlm: 5,
  created_at: "2026-07-11T10:00:00Z",
  ...over,
});

const fe = (id: string, at: string, txHash = ""): FeedEvent => ({
  id, kind: "paid", label: id, txHash, at,
});

describe("activityToFeedEvent", () => {
  it("maps a pay row with a shortened address and amount", () => {
    const e = activityToFeedEvent(row());
    expect(e.id).toBe("sb-1");
    expect(e.kind).toBe("paid");
    expect(e.label).toContain("GAJD…NK46");
    expect(e.label).toContain("5 XLM");
    expect(e.txHash).toBe("abc123");
  });

  it("maps reject to a blocked item and survives a null tx hash", () => {
    const e = activityToFeedEvent(row({ action: "reject", tx_hash: null, amount_xlm: null }));
    expect(e.kind).toBe("blocked");
    expect(e.txHash).toBe("");
    expect(e.label).toContain("blocked");
  });

  it("parses numeric-as-string amounts (postgres numeric)", () => {
    const e = activityToFeedEvent(row({ amount_xlm: "7.5" }));
    expect(e.amountXlm).toBe(7.5);
  });

  it("carries the row's treasury_id so feeds can filter per treasury", () => {
    expect(activityToFeedEvent(row()).treasuryId).toBe("CTREASURY");
    expect(activityToFeedEvent(row({ treasury_id: null })).treasuryId).toBeUndefined();
  });

  it("falls back gracefully on unknown actions", () => {
    const e = activityToFeedEvent(row({ action: "mystery" }));
    expect(e.kind).toBe("mystery");
    expect(e.label).toContain("mystery");
  });
});

describe("mergeFeedEvents", () => {
  it("drops secondary items whose tx hash the primary already has", () => {
    const out = mergeFeedEvents([fe("chain", "2026-07-02T10:00:00Z", "tx1")], [fe("sb", "2026-07-02T10:00:01Z", "tx1")]);
    expect(out.map((e) => e.id)).toEqual(["chain"]);
  });

  it("keeps secondary items without a tx hash", () => {
    const out = mergeFeedEvents([fe("chain", "2026-07-02T10:00:00Z", "tx1")], [fe("sb", "2026-07-01T10:00:00Z")]);
    expect(out.map((e) => e.id)).toEqual(["chain", "sb"]);
  });

  it("sorts newest first and caps the list", () => {
    const out = mergeFeedEvents(
      [fe("a", "2026-07-01T10:00:00Z", "t1"), fe("b", "2026-07-03T10:00:00Z", "t2")],
      [fe("c", "2026-07-02T10:00:00Z", "t3")],
      2,
    );
    expect(out.map((e) => e.id)).toEqual(["b", "c"]);
  });
});

function makeFakeSupabase(opts: {
  chainRows?: ChainEventRow[];
  activityRows?: ActivityRow[];
  errorMessage?: string;
}): SupabaseReadClient {
  const { chainRows = [], activityRows = [], errorMessage } = opts;

  function makeBuilder<T extends Record<string, unknown>>(source: T[]): SupabaseQueryBuilder<T> {
    let rows = [...source];
    const builder: SupabaseQueryBuilder<T> = {
      select: () => builder,
      eq: (col, val) => {
        rows = rows.filter((r) => String(r[col] ?? "") === val);
        return builder;
      },
      order: (col, { ascending }) => {
        rows.sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
        return builder;
      },
      limit: async (n) => {
        if (errorMessage) return { data: null, error: { message: errorMessage } };
        return { data: rows.slice(0, n), error: null };
      },
      range: async (from, to) => {
        if (errorMessage) return { data: null, error: { message: errorMessage } };
        return { data: rows.slice(from, to + 1), error: null };
      },
    };
    return builder;
  }

  return {
    from: (table: string) => {
      if (table === "chain_events_public" || table === "chain_events") {
        return makeBuilder(chainRows as unknown as Record<string, unknown>[]);
      }
      return makeBuilder(activityRows as unknown as Record<string, unknown>[]);
    },
  };
}

describe("chainEventToFeedEvent + fetchTreasuryHistory (#43)", () => {
  it("maps chain_events rows into FeedEvents with 7-decimal stroop amounts", () => {
    const ev = chainEventToFeedEvent({
      id: "0001-1",
      closed_at: "2026-07-01T12:00:00Z",
      tx_hash: "tx_old_1",
      contract_id: "COLDTREASURY",
      kind: "paid",
      counterparty: "GBGHXQXR7BQZMZ3EPWXVMBNVFHXHVZQJPVWQGCTLPXQHRTFHXQXR7BQZ",
      amount: "125000000", // 12.5 XLM
    });
    expect(ev.id).toBe("ce-0001-1");
    expect(ev.kind).toBe("paid");
    expect(ev.amountXlm).toBe(12.5);
    expect(ev.treasuryId).toBe("COLDTREASURY");
    expect(ev.txHash).toBe("tx_old_1");
  });

  it("keeps an old treasury's history visible even when >120 newer platform rows exist", async () => {
    const OLD_TREASURY = "COLDTREASURY11111111111111111111111111111111111111111111";
    const OTHER_TREASURY = "CNOTHER2222222222222222222222222222222222222222222222222";

    // 2 old events for OLD_TREASURY, followed by 150 newer events for OTHER_TREASURY.
    const chainRows: ChainEventRow[] = [
      {
        id: "old-1",
        closed_at: "2026-01-01T00:00:00Z",
        tx_hash: "tx-old-1",
        contract_id: OLD_TREASURY,
        kind: "payee_add",
        counterparty: "GPAYEE11111111111111111111111111111111111111111111111111",
        amount: null,
      },
      {
        id: "old-2",
        closed_at: "2026-01-01T01:00:00Z",
        tx_hash: "tx-old-2",
        contract_id: OLD_TREASURY,
        kind: "paid",
        counterparty: "GPAYEE11111111111111111111111111111111111111111111111111",
        amount: "50000000",
      },
    ];
    const activityRows: ActivityRow[] = [
      row({
        id: 1,
        treasury_id: OLD_TREASURY,
        action: "reject",
        tx_hash: null,
        amount_xlm: 99,
        created_at: "2026-01-01T02:00:00Z",
      }),
    ];

    for (let i = 0; i < 150; i++) {
      const ts = new Date(Date.UTC(2026, 6, 1, 0, i, 0)).toISOString();
      chainRows.push({
        id: `newer-${i}`,
        closed_at: ts,
        tx_hash: `tx-newer-${i}`,
        contract_id: OTHER_TREASURY,
        kind: "paid",
        counterparty: "GOTHER",
        amount: "10000000",
      });
      activityRows.push(
        row({
          id: i + 10,
          treasury_id: OTHER_TREASURY,
          action: "pay",
          tx_hash: `tx-newer-${i}`,
          created_at: ts,
        }),
      );
    }

    const client = makeFakeSupabase({ chainRows, activityRows });
    const history = await fetchTreasuryHistory(OLD_TREASURY, {
      limit: 50,
      offset: 0,
      client,
      configured: true,
    });

    expect(history.map((e) => e.id)).toEqual(["sb-1", "ce-old-2", "ce-old-1"]);
    expect(history.every((e) => e.treasuryId === OLD_TREASURY)).toBe(true);
  });

  it("supports server-side pagination via offset and limit", async () => {
    const TREASURY = "CTREASURY_PAGINATED";
    const chainRows: ChainEventRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `ev-${i}`,
      closed_at: `2026-07-0${i + 1}T00:00:00Z`,
      tx_hash: `tx-${i}`,
      contract_id: TREASURY,
      kind: "paid",
      counterparty: "GPAYEE",
      amount: "10000000",
    }));

    const client = makeFakeSupabase({ chainRows });
    const page1 = await fetchTreasuryHistory(TREASURY, {
      limit: 2,
      offset: 0,
      client,
      configured: true,
    });
    const page2 = await fetchTreasuryHistory(TREASURY, {
      limit: 2,
      offset: 2,
      client,
      configured: true,
    });

    expect(page1.map((e) => e.id)).toEqual(["ce-ev-4", "ce-ev-3"]);
    expect(page2.map((e) => e.id)).toEqual(["ce-ev-2", "ce-ev-1"]);
  });

  it("surfaces fetch errors instead of swallowing them as an empty list", async () => {
    const failingClient = makeFakeSupabase({
      errorMessage: "permission denied for view chain_events_public",
    });

    await expect(
      fetchTreasuryHistory("CTREASURY", {
        client: failingClient,
        configured: true,
      }),
    ).rejects.toThrow("permission denied for view chain_events_public");

    await expect(
      fetchActivityHistory(120, {
        client: failingClient,
        configured: true,
      }),
    ).rejects.toThrow("permission denied for view chain_events_public");
  });
});
