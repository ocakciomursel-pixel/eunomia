import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Keypair } from "@stellar/stellar-sdk";
import { memoryCache } from "./cache.js";
import { decodeBudgetRequest } from "./budgetRequestCodec.js";
import { createServer, type ServerContext, type ServerDeps } from "./server.js";
import { memoryExceptionStore, memoryPurchaseLog } from "./store.js";
import type { TreasurySnapshot } from "./treasury.js";

const TREASURY = "CBCBYWUMRD7L6GFTRJME232JUAEJ2B263N5O7MDGCMDFG4FI6GJ5JN36";
const TOKEN = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const PAYEE = "GCB32DDRIOE24JJ66IYB2V44UAYYPRA4UIPGQKM2OINHDK2NPW365XTA";
const ADMIN = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const AGENT_KP = Keypair.random();
const AGENT = AGENT_KP.publicKey();
const NOW = 1_700_000_000;

const SNAPSHOT: TreasurySnapshot = {
  contractId: TREASURY,
  config: {
    admin: ADMIN,
    agent: AGENT,
    token: TOKEN,
    daily_limit: 100_000_000n,
    per_task_limit: 25_000_000n,
  },
  balance: 500_000_000n,
  locked: 0n,
  daySpent: 10_000_000n,
  paused: false,
  session: {
    agent: AGENT,
    valid_until: BigInt(NOW + 3600),
    limit: 50_000_000n,
    spent: 5_000_000n,
  },
  reputationPolicy: {
    registry: TREASURY,
    minReputation: 80n,
  },
  monthlyLimit: 200_000_000n,
  monthSpent: 10_000_000n,
  taskPayees: [],
  legacy: false,
};

function makeDeps(overrides: Partial<ServerDeps> = {}): ServerDeps {
  return {
    makeClient: (() => ({}) as never) as ServerDeps["makeClient"],
    readTreasury: async () => SNAPSHOT,
    isPayee: async (_c, addr) => addr === PAYEE,
    treasuryUnit: async () => "USDC",
    listAllowedPayees: async () => ({
      payees: [PAYEE],
      reputationPolicy: SNAPSHOT.reputationPolicy,
      coverage: {
        cachedBefore: 0,
        eventsScanned: 2,
        fromLedger: 100,
        toLedger: 200,
        oldestRetainedLedger: 50,
        completeForRetentionWindow: true,
        note: "ok",
      },
    }),
    lacksTrustline: async () => false,
    payFromTreasury: async (_ctx, args) => ({
      paid: true,
      stage: "onchain",
      to: args.to,
      amount: args.amount,
      taskId: args.taskId,
      txHash: "abc123tx",
      ledger: 999,
      reasons: [],
      blockers: [],
      message: "Paid.",
    }),
    preflightReasons: async (_ctx, args) => ({
      budget: {
        contractId: TREASURY,
        token: TOKEN,
        paused: false,
        perPaymentCap: 25_000_000n,
        dailyLimit: 100_000_000n,
        daySpent: 10_000_000n,
        dailyRemaining: 90_000_000n,
        freeBalance: 500_000_000n,
        monthly: null,
        taskPayees: [],
        session: null,
        canSpend: true,
        spendableNow: 25_000_000n,
        blockers: [],
        reputationPolicy: null,
      },
      reasons:
        args.amount > 25_000_000n
          ? [{ code: 3, name: "ExceedsTaskLimit", detail: "Over per-payment cap" }]
          : [],
      blockers: [],
    }),
    submitException: async () => ({
      id: "exc001",
      entryName: `eunomia.x.${TREASURY.slice(0, 8)}.exc001`,
      txHash: "exctx123",
      ledger: 1001,
    }),
    readExceptionEntry: async (_net, _agent, name) =>
      name.endsWith("missing")
        ? null
        : {
            version: 1,
            payee: PAYEE,
            amount: 150_000_000n,
            taskId: 7n,
            reasonCodes: [3],
            requestedAt: NOW - 60,
          },
    closeException: async () => ({ txHash: "closetx123", ledger: 1002 }),
    searchServices: async () => ({
      total: 1,
      routes: [
        {
          id: "svc-1",
          name: "Search API",
          description: "Web search",
          category: "search",
          url: "https://api.example.com/search",
          method: "POST",
          priceUsdc: "0.01",
          priceStroops: "100000",
          payTo: PAYEE,
          verified: true,
        },
      ],
    }),
    fundFloat: async (_ctx, amount, taskId) => ({
      paid: true,
      stage: "onchain",
      to: AGENT,
      amount,
      taskId,
      txHash: "floattx123",
      ledger: 1003,
      reasons: [],
      blockers: [],
      message: "Float funded.",
    }),
    callService: async (_ctx, req) => ({
      paid: true,
      status: 200,
      amount: 100_000n,
      payTo: PAYEE,
      txHash: "calltx123",
      body: { answer: 42, url: req.url },
    }),
    sweepFloat: async (_ctx, amount) => ({
      swept: amount ?? 4_000_000n,
      txHash: "sweeptx123",
      ledger: 1004,
      status: "SUCCESS",
    }),
    tokenBalance: async () => 4_000_000n,
    ...overrides,
  };
}

function makeContext(overrides: Partial<ServerContext> = {}): ServerContext {
  return {
    net: {
      name: "pubnet",
      rpcUrl: "https://rpc.example.com",
      horizonUrl: "https://horizon.stellar.org",
      passphrase: "Public Global Stellar Network ; September 2015",
      explorer: "https://stellar.expert/explorer/public",
    },
    treasuryId: TREASURY,
    credential: {
      version: 1,
      network: "pubnet",
      treasuryId: TREASURY,
      agentPublicKey: AGENT,
      agentSecret: AGENT_KP.secret(),
      createdAt: "2026-10-01T00:00:00Z",
    },
    cache: memoryCache(),
    exceptions: memoryExceptionStore(),
    purchases: memoryPurchaseLog(),
    appUrl: "https://eunomia.finance",
    now: () => NOW,
    deps: makeDeps(),
    ...overrides,
  };
}

async function withConnectedClient<T>(
  ctx: ServerContext,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(ctx);
  const client = new Client({ name: "eunomia-protocol-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

test("listTools matches the 12 tools in README.md and exposes their schemas", async () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const tableSection = readme.split("## Tools")[1]?.split("###")[0] ?? "";
  const readmeTools = Array.from(tableSection.matchAll(/^\|\s*`([a-z0-9_]+)`\s*\|/gm), (m) => m[1]);
  assert.equal(readmeTools.length, 12);

  await withConnectedClient(makeContext(), async (client) => {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((t) => t.name),
      readmeTools,
    );
    for (const tool of listed.tools) {
      assert.ok(tool.description && tool.description.length > 10, `${tool.name} has a description`);
      assert.equal(tool.inputSchema.type, "object", `${tool.name} has an object inputSchema`);
    }
  });
});

test("every tool succeeds over the MCP protocol with mocked dependencies", async () => {
  const ctx = makeContext();
  await withConnectedClient(ctx, async (client) => {
    // 1. check_budget
    const budgetRes = await client.callTool({ name: "check_budget", arguments: { amount: "2.5" } });
    assert.ok(!budgetRes.isError);
    const budgetData = budgetRes.structuredContent as Record<string, unknown>;
    assert.equal(budgetData.treasury, TREASURY);
    assert.equal(budgetData.unit, "USDC");
    assert.equal(budgetData.canSpend, true);

    // 2. list_allowed_payees
    const listRes = await client.callTool({ name: "list_allowed_payees", arguments: {} });
    assert.ok(!listRes.isError);
    const listData = listRes.structuredContent as Record<string, unknown>;
    assert.deepEqual(listData.payees, [PAYEE]);

    // 3. check_payee
    const payeeRes = await client.callTool({ name: "check_payee", arguments: { address: PAYEE } });
    assert.ok(!payeeRes.isError);
    const payeeData = payeeRes.structuredContent as Record<string, unknown>;
    assert.equal(payeeData.allowed, true);
    assert.equal(payeeData.via, "whitelist");

    // 4. request_exception (over per-payment cap: 15 > 2.5)
    const reqExcRes = await client.callTool({
      name: "request_exception",
      arguments: { to: PAYEE, amount: "15", taskId: 7 },
    });
    assert.ok(!reqExcRes.isError);
    const reqExcData = reqExcRes.structuredContent as Record<string, unknown>;
    assert.equal(reqExcData.requested, true);
    assert.equal(reqExcData.id, "exc001");

    // 5. check_exception (pending, then close: true)
    const chkExcRes = await client.callTool({
      name: "check_exception",
      arguments: { id: "exc001" },
    });
    assert.ok(!chkExcRes.isError);
    const chkExcData = chkExcRes.structuredContent as Record<string, unknown>;
    assert.equal(chkExcData.status, "pending");

    // 6. pay (and closes matching stored exception when paid)
    const payRes = await client.callTool({
      name: "pay",
      arguments: { to: PAYEE, amount: "15", taskId: 7 },
    });
    assert.ok(!payRes.isError);
    const payData = payRes.structuredContent as Record<string, unknown>;
    assert.equal(payData.paid, true);
    assert.equal(payData.txHash, "abc123tx");
    assert.deepEqual(payData.closedExceptions, [{ id: "exc001", txHash: "closetx123" }]);

    // 7. find_services
    const findRes = await client.callTool({
      name: "find_services",
      arguments: { query: "search", category: "search", verifiedOnly: true, limit: 5 },
    });
    assert.ok(!findRes.isError);
    const findData = findRes.structuredContent as Record<string, unknown>;
    assert.equal(findData.total, 1);

    // 8. fund_float
    const fundRes = await client.callTool({
      name: "fund_float",
      arguments: { amount: "0.5", taskId: 9 },
    });
    assert.ok(!fundRes.isError);
    const fundData = fundRes.structuredContent as Record<string, unknown>;
    assert.equal(fundData.float, true);
    assert.equal(fundData.paid, true);

    // 9. call_service (records purchase in ctx.purchases)
    const callRes = await client.callTool({
      name: "call_service",
      arguments: {
        url: "https://api.example.com/search",
        method: "POST",
        body: { q: "stellar" },
        maxPrice: "0.05",
        service: "svc-1",
      },
    });
    assert.ok(!callRes.isError);
    const callData = callRes.structuredContent as Record<string, unknown>;
    assert.equal(callData.paid, true);
    assert.equal(callData.price, "0.01");

    // 10. float_status (reads tokenBalance + purchase log)
    const statusRes = await client.callTool({
      name: "float_status",
      arguments: { last: 5 },
    });
    assert.ok(!statusRes.isError);
    const statusData = statusRes.structuredContent as Record<string, unknown>;
    assert.equal(statusData.float, "0.4");
    assert.equal((statusData.purchases as unknown[]).length, 1);

    // 11. sweep_float
    const sweepRes = await client.callTool({
      name: "sweep_float",
      arguments: { amount: "0.25" },
    });
    assert.ok(!sweepRes.isError);
    const sweepData = sweepRes.structuredContent as Record<string, unknown>;
    assert.equal(sweepData.swept, "0.25");
    assert.equal(sweepData.status, "SUCCESS");

    // 12. request_budget (returns signed approvalUrl that verifies)
    const reqBudgetRes = await client.callTool({
      name: "request_budget",
      arguments: {
        amount: "5",
        hours: 24,
        payees: [PAYEE],
        task: "Run market data queries",
      },
    });
    assert.ok(!reqBudgetRes.isError);
    const reqBudgetData = reqBudgetRes.structuredContent as Record<string, unknown>;
    assert.equal(reqBudgetData.requested, true);
    const url = new URL(String(reqBudgetData.approvalUrl));
    const decoded = decodeBudgetRequest(url.searchParams, NOW);
    assert.equal(decoded.verified, true);
    assert.equal(decoded.request?.treasury, TREASURY);
    assert.equal(decoded.request?.agent, AGENT);
    assert.deepEqual(decoded.request?.payees, [PAYEE]);
  });
});

test("every tool returns isError: true when unconfigured or when a dependency throws", async () => {
  // 1. Unconfigured treasury / credential
  const noTreasuryCtx = makeContext({ treasuryId: null, credential: null });
  await withConnectedClient(noTreasuryCtx, async (client) => {
    for (const [name, args] of [
      ["check_budget", {}],
      ["list_allowed_payees", {}],
      ["check_payee", { address: PAYEE }],
      ["pay", { to: PAYEE, amount: "1" }],
      ["request_exception", { to: PAYEE, amount: "1" }],
      ["check_exception", { id: "exc001" }],
      ["fund_float", { amount: "1" }],
      ["call_service", { url: "https://api.example.com/x", maxPrice: "0.01" }],
      ["sweep_float", {}],
      ["float_status", {}],
      ["request_budget", { amount: "5", hours: 1, payees: [PAYEE], task: "test" }],
    ] as const) {
      const r = await client.callTool({ name, arguments: args });
      assert.equal(r.isError, true, `${name} should return isError without treasury`);
    }
  });

  // 2. Invalid contract id + dependency errors (covering find_services and handler catch blocks)
  const throwingCtx = makeContext({
    deps: makeDeps({
      readTreasury: async () => {
        throw new Error("RPC down");
      },
      searchServices: async () => {
        throw new Error("catalog unreachable");
      },
      fundFloat: async () => {
        throw new Error("float failure");
      },
      callService: async () => {
        throw new Error("service failure");
      },
      sweepFloat: async () => {
        throw new Error("sweep failure");
      },
      preflightReasons: async () => {
        throw new Error("preflight failure");
      },
      readExceptionEntry: async () => {
        throw new Error("horizon failure");
      },
    }),
  });
  await withConnectedClient(throwingCtx, async (client) => {
    for (const [name, args] of [
      ["check_budget", {}],
      ["list_allowed_payees", {}],
      ["check_payee", { address: PAYEE }],
      ["pay", {}], // missing to/amount and x402
      ["request_exception", { to: PAYEE, amount: "1" }],
      ["check_exception", { id: "exc001" }],
      ["find_services", { query: "x" }],
      ["fund_float", { amount: "1" }],
      ["call_service", { url: "https://api.example.com/x", maxPrice: "0.01" }],
      ["sweep_float", {}],
      ["float_status", {}],
      ["request_budget", { amount: "not-a-number", hours: 1, payees: [PAYEE], task: "test" }],
    ] as const) {
      const r = await client.callTool({ name, arguments: args });
      assert.equal(r.isError, true, `${name} should return isError on failure`);
    }
  });
});
