import { afterEach, describe, expect, it, vi } from "vitest";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-base";
import { MAX_PAGES, cursorLedger, rpc, run, type Env } from "../src/index";
import type { RpcEvent } from "../src/decode";
import { PUBNET } from "../../../web/src/networks";

const OWNER = "GCB32DDRIOE24JJ66IYB2V44UAYYPRA4UIPGQKM2OINHDK2NPW365XTA";
const TREASURY = "CADUYW6CJ7QYEL5QMFT43YBOT2QJ2LBEA34UYHJYMHWQQUNUADGNP7QO";
const REGISTRY = PUBNET.registryId;

const ENV: Env = {
  NETWORK: "mainnet",
  RPC_URL: "https://rpc.example.com",
  REGISTRY_ID: REGISTRY,
  SUPABASE_URL: "https://db.example.com",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
};

const b64 = (v: xdr.ScVal) => v.toXDR("base64");
const sym = (s: string) => b64(xdr.ScVal.scvSymbol(s));
const addr = (a: string) => new Address(a).toScVal();
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });
const toidCursor = (ledger: number, seq = 1) => `${(BigInt(ledger) << 32n).toString()}-${String(seq).padStart(10, "0")}`;

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rpc()", () => {
  it("checks res.ok before parsing JSON and does not retry 4xx errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("<html><body>403 Forbidden</body></html>", { status: 403 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const sleeps: number[] = [];

    await expect(rpc(ENV, "getHealth", {}, async (ms) => void sleeps.push(ms))).rejects.toThrow(
      /getHealth: HTTP 403.*403 Forbidden/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it("retries 5xx and network errors with exponential backoff", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 }))
      .mockResolvedValueOnce(jsonRes({ jsonrpc: "2.0", id: 1, result: { oldestLedger: 1000 } }));
    vi.stubGlobal("fetch", fetchMock);
    const sleeps: number[] = [];

    const result = await rpc<{ oldestLedger: number }>(ENV, "getHealth", {}, async (ms) => {
      sleeps.push(ms);
    });
    expect(result).toEqual({ oldestLedger: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([200, 400]);
  });
});

describe("run()", () => {
  it("recovers from a stale cursor older than getHealth().oldestLedger", async () => {
    const staleCursor = toidCursor(4_000_000);
    const headCursor = toidCursor(5_000_100);
    expect(cursorLedger(staleCursor)).toBe(4_000_000);

    const getEventsCalls: Record<string, unknown>[] = [];
    const cursorUpserts: unknown[] = [];

    const regEvent: RpcEvent = {
      id: toidCursor(5_000_050, 1),
      ledger: 5_000_050,
      ledgerClosedAt: "2026-10-20T10:00:00Z",
      txHash: "tx1",
      contractId: REGISTRY,
      topic: [sym("regd"), b64(addr(OWNER))],
      value: b64(addr(TREASURY)),
    };
    const paidEvent: RpcEvent = {
      id: toidCursor(5_000_060, 2),
      ledger: 5_000_060,
      ledgerClosedAt: "2026-10-20T10:01:00Z",
      txHash: "tx2",
      contractId: TREASURY,
      topic: [sym("paid"), b64(nativeToScVal(1n, { type: "u64" }))],
      value: b64(xdr.ScVal.scvVec([addr(OWNER), i128(10_000_000n)])),
    };

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/rest/v1/chain_treasuries?network=")) {
        return jsonRes([]);
      }
      if (url.includes("/rest/v1/chain_cursor?network=")) {
        return jsonRes([{ cursor: staleCursor }]);
      }
      if (url.includes("/rest/v1/chain_treasuries?on_conflict=")) {
        return new Response(null, { status: 201 });
      }
      if (url.includes("/rest/v1/chain_events?on_conflict=")) {
        return new Response(null, { status: 201 });
      }
      if (url.includes("/rest/v1/chain_cursor?on_conflict=")) {
        cursorUpserts.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 201 });
      }
      if (url === ENV.RPC_URL) {
        const req = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> };
        if (req.method === "getHealth") {
          return jsonRes({ jsonrpc: "2.0", id: 1, result: { oldestLedger: 5_000_000 } });
        }
        if (req.method === "getEvents") {
          getEventsCalls.push(req.params);
          return jsonRes({
            jsonrpc: "2.0",
            id: 1,
            result: {
              events: [regEvent, paidEvent],
              cursor: headCursor,
              latestLedger: 5_000_100,
            },
          });
        }
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await run(ENV, { sleep: async () => {} });
    expect(summary).toEqual({ pages: 1, registrations: 1, events: 1 });
    expect(getEventsCalls).toHaveLength(1);
    // Stale cursor was discarded in favour of startLedger = oldestLedger + 1
    expect(getEventsCalls[0].startLedger).toBe(5_000_001);
    expect(getEventsCalls[0].pagination).toEqual({ limit: 500 });
    expect(cursorUpserts).toHaveLength(1);
  });

  it("keeps a fresh cursor when its ledger is within the RPC retention window", async () => {
    const activeCursor = toidCursor(5_000_050);
    const nextCursor = toidCursor(5_000_100);
    const getEventsCalls: Record<string, unknown>[] = [];

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/rest/v1/chain_treasuries?network=")) return jsonRes([{ treasury_id: TREASURY }]);
      if (url.includes("/rest/v1/chain_cursor?network=")) return jsonRes([{ cursor: activeCursor }]);
      if (url.includes("/rest/v1/")) return new Response(null, { status: 201 });
      const req = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> };
      if (req.method === "getHealth") {
        return jsonRes({ jsonrpc: "2.0", id: 1, result: { oldestLedger: 5_000_000 } });
      }
      getEventsCalls.push(req.params);
      return jsonRes({
        jsonrpc: "2.0",
        id: 1,
        result: { events: [], cursor: nextCursor, latestLedger: 5_000_100 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await run(ENV, { sleep: async () => {} });
    expect(summary).toEqual({ pages: 1, registrations: 0, events: 0 });
    expect(getEventsCalls[0].startLedger).toBeUndefined();
    expect(getEventsCalls[0].pagination).toEqual({ cursor: activeCursor, limit: 500 });
  });

  it("caps paging at MAX_PAGES so subrequests stay within the Workers Free limit", async () => {
    let seq = 5_000_001;
    let totalRequests = 0;

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      totalRequests++;
      const url = String(input);
      if (url.includes("/rest/v1/chain_treasuries?network=")) return jsonRes([]);
      if (url.includes("/rest/v1/chain_cursor?network=")) return jsonRes([]);
      if (url.includes("/rest/v1/")) return new Response(null, { status: 201 });
      const req = JSON.parse(String(init?.body)) as { method: string };
      if (req.method === "getHealth") {
        return jsonRes({ jsonrpc: "2.0", id: 1, result: { oldestLedger: 5_000_000 } });
      }
      const next = toidCursor(++seq);
      return jsonRes({
        jsonrpc: "2.0",
        id: 1,
        result: { events: [], cursor: next, latestLedger: 5_999_999 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await run(ENV, { sleep: async () => {} });
    expect(summary.pages).toBe(MAX_PAGES);
    expect(MAX_PAGES).toBeLessThanOrEqual(10);
    expect(totalRequests).toBeLessThanOrEqual(50);
  });
});
