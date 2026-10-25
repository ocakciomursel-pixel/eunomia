import { test } from "node:test";
import assert from "node:assert/strict";
import { Address, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { readPeriodPayments, type RpcEventsServer } from "./chain.js";

const TREASURY = "CBCBYWUMRD7L6GFTRJME232JUAEJ2B263N5O7MDGCMDFG4FI6GJ5JN36";
const PAYEE_1 = "GCB32DDRIOE24JJ66IYB2V44UAYYPRA4UIPGQKM2OINHDK2NPW365XTA";
const PAYEE_2 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const toidCursor = (ledger: number) => `${(BigInt(ledger) << 32n).toString()}-0000000001`;

function makePaidEvent(opts: {
  to: string;
  amount: bigint;
  taskId: bigint;
  closedAt: string;
  ledger: number;
  txHash: string;
}): rpc.Api.EventResponse {
  return {
    type: "contract",
    ledger: opts.ledger,
    ledgerClosedAt: opts.closedAt,
    contractId: new Address(TREASURY).toString(),
    id: toidCursor(opts.ledger),
    pagingToken: toidCursor(opts.ledger),
    inSuccessfulContractCall: true,
    topic: [xdr.ScVal.scvSymbol("paid"), nativeToScVal(opts.taskId, { type: "u64" })],
    value: xdr.ScVal.scvVec([new Address(opts.to).toScVal(), nativeToScVal(opts.amount, { type: "i128" })]),
    txHash: opts.txHash,
  } as unknown as rpc.Api.EventResponse;
}

test("readPeriodPayments pages through empty slices and keeps only events inside the UTC day", async () => {
  // Period 20000 -> dayStart = 20000 * 86400 = 1728000000 (2024-10-04T00:00:00Z),
  // dayEnd = 1728086400 (2024-10-05T00:00:00Z)
  const periodId = 20_000;
  const beforeDay = "2024-10-03T23:59:59Z";
  const inDay1 = "2024-10-04T00:00:00Z";
  const inDay2 = "2024-10-04T15:30:00Z";
  const atDayEnd = "2024-10-05T00:00:00Z";

  const pages: rpc.Api.GetEventsResponse[] = [
    // Page 1: one event before dayStart, one at dayStart; cursor at ledger 1050 (< latest 1200)
    {
      events: [
        makePaidEvent({ to: PAYEE_1, amount: 1_000_000n, taskId: 1n, closedAt: beforeDay, ledger: 1010, txHash: "tx0" }),
        makePaidEvent({ to: PAYEE_1, amount: 25_000_000n, taskId: 2n, closedAt: inDay1, ledger: 1020, txHash: "tx1" }),
      ],
      cursor: toidCursor(1050),
      latestLedger: 1200,
    } as unknown as rpc.Api.GetEventsResponse,
    // Page 2: empty slice, cursor advances to 1100
    {
      events: [],
      cursor: toidCursor(1100),
      latestLedger: 1200,
    } as unknown as rpc.Api.GetEventsResponse,
    // Page 3: one event inside the day, one at dayEnd (excluded); cursor reaches latestLedger 1200
    {
      events: [
        makePaidEvent({ to: PAYEE_2, amount: 50_000_000n, taskId: 9n, closedAt: inDay2, ledger: 1150, txHash: "tx2" }),
        makePaidEvent({ to: PAYEE_2, amount: 99_000_000n, taskId: 10n, closedAt: atDayEnd, ledger: 1190, txHash: "tx3" }),
      ],
      cursor: toidCursor(1200),
      latestLedger: 1200,
    } as unknown as rpc.Api.GetEventsResponse,
  ];

  let callIdx = 0;
  const server: RpcEventsServer = {
    getLatestLedger: async () => ({ id: "h", protocolVersion: 22, sequence: 1200 }),
    getEvents: async () => pages[callIdx++],
  };

  const payments = await readPeriodPayments("https://rpc.example.com", TREASURY, periodId, server);
  assert.equal(callIdx, 3);
  assert.deepEqual(payments, [
    {
      to: PAYEE_1,
      amount: 25_000_000n,
      taskId: 2n,
      txHash: "tx1",
      ledger: 1020,
      closedAt: inDay1,
    },
    {
      to: PAYEE_2,
      amount: 50_000_000n,
      taskId: 9n,
      txHash: "tx2",
      ledger: 1150,
      closedAt: inDay2,
    },
  ]);
});
