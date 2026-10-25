import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { readPeriodPayments, type RpcEventsClient } from "./chain.js";

const TREASURY = "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const PAYEE_A = "GDOMW4C36BUBBFJW3V4L22LUICOUKFVTPGOYU6UMZZ6D3ENEOCH4QCRT";
const PAYEE_B = "GB4GJNEZ6KLZNU3TE2CHQFNPOEQL5SHPQ246OMRZRLKVVQNLZCDX2QXZ";

function makeEvent(
  kind: "paid" | "escrowed" | "released" | "refunded",
  id: bigint,
  to: string,
  amount: bigint,
  iso: string,
  txHash: string,
  ledger: number,
) {
  return {
    ledgerClosedAt: iso,
    topic: [
      xdr.ScVal.scvSymbol(kind),
      nativeToScVal(id, { type: "u64" }),
    ],
    value: nativeToScVal([to, amount]),
    txHash,
    ledger,
  };
}

describe("readPeriodPayments", () => {
  it("reads both paid and escrowed events in the target UTC day and ignores released/refunded events", async () => {
    // Period 20000 = 20000 * 86400 = 1728000000 (2024-10-04T00:00:00Z .. 2024-10-05T00:00:00Z)
    const periodId = 20_000;
    const calls: unknown[] = [];

    const client: RpcEventsClient = {
      async getLatestLedger() {
        return { sequence: 500_000 };
      },
      async getEvents(req) {
        calls.push(req);
        if (!("cursor" in req && req.cursor)) {
          return {
            events: [
              // Before period (ignored)
              makeEvent("paid", 1n, PAYEE_A, 100n, "2024-10-03T23:59:59Z", "tx-before", 490_000),
              // Direct payment inside period
              makeEvent("paid", 2n, PAYEE_A, 250n, "2024-10-04T08:00:00Z", "tx-paid", 491_000),
            ],
            cursor: `${(495_000n << 32n).toString()}-0`,
            latestLedger: 500_000,
          };
        }
        return {
          events: [
            // Escrow commitment inside period (counts once toward period_spent)
            makeEvent("escrowed", 0n, PAYEE_B, 400n, "2024-10-04T15:30:00Z", "tx-escrow", 496_000),
            // Released & refunded events (must not be double-counted or added)
            makeEvent("released", 0n, PAYEE_B, 400n, "2024-10-04T18:00:00Z", "tx-release", 496_500),
            makeEvent("refunded", 9n, PAYEE_A, 150n, "2024-10-04T19:00:00Z", "tx-refund", 496_800),
            // At/after period end (ignored)
            makeEvent("paid", 4n, PAYEE_A, 999n, "2024-10-05T00:00:00Z", "tx-after", 498_000),
          ],
          cursor: `${(500_000n << 32n).toString()}-0`,
          latestLedger: 500_000,
        };
      },
    };

    const payments = await readPeriodPayments("https://rpc.example", TREASURY, periodId, client);
    assert.equal(calls.length, 2);
    assert.equal(payments.length, 2);
    assert.deepEqual(payments[0], {
      to: PAYEE_A,
      amount: 250n,
      taskId: 2n,
      kind: "paid",
      txHash: "tx-paid",
      ledger: 491_000,
      closedAt: "2024-10-04T08:00:00Z",
    });
    assert.deepEqual(payments[1], {
      to: PAYEE_B,
      amount: 400n,
      taskId: 0n,
      kind: "escrowed",
      txHash: "tx-escrow",
      ledger: 496_000,
      closedAt: "2024-10-04T15:30:00Z",
    });
    const total = payments.reduce((s, p) => s + p.amount, 0n);
    assert.equal(total, 650n);
  });
});
