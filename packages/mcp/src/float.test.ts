import { test } from "node:test";
import assert from "node:assert/strict";
import { Account, Asset, Keypair, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { memoryCache } from "./cache.js";
import { addTrustline, sweepFloat, tokenBalance } from "./float.js";
import type { ServerContext } from "./server.js";
import { memoryExceptionStore } from "./store.js";

const TREASURY = "CBCBYWUMRD7L6GFTRJME232JUAEJ2B263N5O7MDGCMDFG4FI6GJ5JN36";
const TOKEN = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = new Asset("USDC", ISSUER);
const AGENT_KP = Keypair.random();

const NET = {
  name: "pubnet" as const,
  rpcUrl: "https://rpc.example.com",
  horizonUrl: "https://horizon.stellar.org",
  passphrase: "Public Global Stellar Network ; September 2015",
  explorer: "https://stellar.expert/explorer/public",
};

function makeCtx(withCredential = true): ServerContext {
  return {
    net: NET,
    treasuryId: TREASURY,
    credential: withCredential
      ? {
          version: 1,
          network: "pubnet",
          treasuryId: TREASURY,
          agentPublicKey: AGENT_KP.publicKey(),
          agentSecret: AGENT_KP.secret(),
          createdAt: "2026-10-01T00:00:00Z",
        }
      : null,
    cache: memoryCache(),
    exceptions: memoryExceptionStore(),
  };
}

function mockRpcServer(opts: {
  balanceStroops?: bigint | null;
  sendStatus?: string;
}): rpc.Server {
  return {
    simulateTransaction: async () => {
      if (opts.balanceStroops === null || opts.balanceStroops === undefined) {
        return { error: "HostError" };
      }
      return {
        result: {
          retval: nativeToScVal(opts.balanceStroops, { type: "i128" }),
          auth: [],
        },
        transactionData: "",
        minResourceFee: "100",
        latestLedger: 1000,
      };
    },
    getAccount: async (pub: string) => new Account(pub, "100"),
    prepareTransaction: async (tx: unknown) => tx,
    sendTransaction: async () => ({
      status: opts.sendStatus ?? "PENDING",
      hash: "sweeptxhash",
    }),
  } as unknown as rpc.Server;
}

test("tokenBalance reads SEP-41 balance via simulation and returns 0n when simulation fails", async () => {
  const okServer = mockRpcServer({ balanceStroops: 12_500_000n });
  assert.equal(await tokenBalance(NET, TOKEN, AGENT_KP.publicKey(), okServer), 12_500_000n);

  const errServer = mockRpcServer({ balanceStroops: null });
  assert.equal(await tokenBalance(NET, TOKEN, AGENT_KP.publicKey(), errServer), 0n);
});

test("sweepFloat returns NOTHING on zero balance, sweeps held tokens, and rejects invalid sweeps", async () => {
  const ctx = makeCtx();

  // 1. Zero balance -> NOTHING
  const emptyRes = await sweepFloat(ctx, undefined, {
    server: mockRpcServer({ balanceStroops: 0n }),
    token: TOKEN,
    asset: USDC,
  });
  assert.deepEqual(emptyRes, { swept: 0n, txHash: null, ledger: 0, status: "NOTHING" });

  // 2. Native XLM without explicit amount -> refuses to empty reserve
  await assert.rejects(
    () =>
      sweepFloat(ctx, undefined, {
        server: mockRpcServer({ balanceStroops: 50_000_000n }),
        token: TOKEN,
        asset: Asset.native(),
      }),
    /holds XLM/,
  );

  // 3. Amount greater than held -> refuses
  await assert.rejects(
    () =>
      sweepFloat(ctx, 20_000_000n, {
        server: mockRpcServer({ balanceStroops: 5_000_000n }),
        token: TOKEN,
        asset: USDC,
      }),
    /less than the 20000000 asked to sweep/,
  );

  // 4. Successful sweep
  const okRes = await sweepFloat(ctx, undefined, {
    server: mockRpcServer({ balanceStroops: 7_500_000n }),
    token: TOKEN,
    asset: USDC,
    poll: async () =>
      ({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        ledger: 4321,
      }) as never,
  });
  assert.deepEqual(okRes, {
    swept: 7_500_000n,
    txHash: "sweeptxhash",
    ledger: 4321,
    status: "SUCCESS",
  });

  // 5. Rejected submission -> throws
  await assert.rejects(
    () =>
      sweepFloat(ctx, 1_000_000n, {
        server: mockRpcServer({ balanceStroops: 5_000_000n, sendStatus: "ERROR" }),
        token: TOKEN,
        asset: USDC,
      }),
    /refused the sweep at submission/,
  );
});

test("addTrustline skips native XLM and existing trustlines, and submits changeTrust when needed", async () => {
  const ctx = makeCtx();

  // 1. Native XLM -> NOT_NEEDED
  const xlmRes = await addTrustline(ctx, { token: TOKEN, asset: Asset.native() });
  assert.deepEqual(xlmRes, { asset: "XLM", txHash: null, status: "NOT_NEEDED" });

  // 2. Already has trustline -> NOT_NEEDED
  const hasRes = await addTrustline(ctx, {
    token: TOKEN,
    asset: USDC,
    lacks: async () => false,
  });
  assert.deepEqual(hasRes, { asset: `USDC:${ISSUER}`, txHash: null, status: "NOT_NEEDED" });

  // 3. Missing trustline -> submits changeTrust
  const addedRes = await addTrustline(ctx, {
    token: TOKEN,
    asset: USDC,
    lacks: async () => true,
    submit: async () => ({ txHash: "trusttx123", ledger: 555, status: "SUCCESS" }),
  });
  assert.deepEqual(addedRes, {
    asset: `USDC:${ISSUER}`,
    txHash: "trusttx123",
    status: "SUCCESS",
  });

  // 4. Missing credential -> throws
  await assert.rejects(() => addTrustline(makeCtx(false), { token: TOKEN, asset: USDC }), /No agent credential/);
});
