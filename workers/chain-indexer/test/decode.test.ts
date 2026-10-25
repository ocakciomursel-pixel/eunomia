import { describe, expect, it } from "vitest";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-base";
import { TREASURY_KINDS, toEventRow, toRegistration, type RpcEvent } from "../src/decode";

const OWNER = "GCB32DDRIOE24JJ66IYB2V44UAYYPRA4UIPGQKM2OINHDK2NPW365XTA";
const TREASURY = "CADUYW6CJ7QYEL5QMFT43YBOT2QJ2LBEA34UYHJYMHWQQUNUADGNP7QO";
const b64 = (v: xdr.ScVal) => v.toXDR("base64");
const sym = (s: string) => b64(xdr.ScVal.scvSymbol(s));
const addr = (a: string) => new Address(a).toScVal();
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });

const event = (topic: string[], value: xdr.ScVal): RpcEvent => ({
  id: "0021794416406605824-0000000000",
  ledger: 5074408,
  ledgerClosedAt: "2026-10-09T10:00:00Z",
  txHash: "9d8e",
  contractId: TREASURY,
  topic,
  value: b64(value),
});

describe("toRegistration", () => {
  it("reads (regd, owner) -> treasury", () => {
    const r = toRegistration(event([sym("regd"), b64(addr(OWNER))], addr(TREASURY)), "mainnet");
    expect(r).toEqual({
      network: "mainnet",
      treasury_id: TREASURY,
      owner: OWNER,
      registered_at: "2026-10-09T10:00:00Z",
    });
  });

  it("ignores other registry topics", () => {
    expect(toRegistration(event([sym("other")], addr(TREASURY)), "mainnet")).toBeNull();
  });
});

describe("toEventRow", () => {
  it("paid: (paid, task_id) -> (to, amount)", () => {
    const value = xdr.ScVal.scvVec([addr(OWNER), i128(50_000_000n)]);
    const row = toEventRow(event([sym("paid"), b64(nativeToScVal(7n, { type: "u64" }))], value), "mainnet");
    expect(row).toMatchObject({
      kind: "paid",
      counterparty: OWNER,
      amount: "50000000",
      contract_id: TREASURY,
      detail: null,
    });
  });

  it("session: (agent, valid_until, limit) keeps the agent and the limit", () => {
    const value = xdr.ScVal.scvVec([addr(OWNER), nativeToScVal(123n, { type: "u64" }), i128(10_000_000n)]);
    expect(toEventRow(event([sym("session")], value), "mainnet")).toMatchObject({
      kind: "session",
      counterparty: OWNER,
      amount: "10000000",
      detail: null,
    });
  });

  it("limits: (daily, per_task) stores daily in amount and per_task in detail", () => {
    const value = xdr.ScVal.scvVec([i128(100_000_000n), i128(25_000_000n)]);
    expect(toEventRow(event([sym("limits")], value), "mainnet")).toMatchObject({
      kind: "limits",
      counterparty: null,
      amount: "100000000",
      detail: { per_task: "25000000" },
    });
  });

  it("payee_add: a bare address payload", () => {
    expect(toEventRow(event([sym("payee_add")], addr(OWNER)), "mainnet")).toMatchObject({
      kind: "payee_add",
      counterparty: OWNER,
      amount: null,
      detail: null,
    });
  });

  it("rep_gate: (registry, min_reputation) keeps the registry address and threshold", () => {
    expect(TREASURY_KINDS).toContain("rep_gate");
    const value = xdr.ScVal.scvVec([addr(TREASURY), i128(80n)]);
    expect(toEventRow(event([sym("rep_gate")], value), "mainnet")).toMatchObject({
      kind: "rep_gate",
      counterparty: TREASURY,
      amount: "80",
      detail: null,
    });
  });

  it("wl_root: BytesN<32> stores the hex Merkle root in detail", () => {
    expect(TREASURY_KINDS).toContain("wl_root");
    const rootBytes = new Uint8Array(32).fill(0xab);
    const value = xdr.ScVal.scvBytes(rootBytes);
    expect(toEventRow(event([sym("wl_root")], value), "mainnet")).toMatchObject({
      kind: "wl_root",
      counterparty: null,
      amount: null,
      detail: { root: "ab".repeat(32) },
    });
  });

  it("v4 deposit: (deposit, from) -> amount", () => {
    expect(toEventRow(event([sym("deposit"), b64(addr(OWNER))], i128(250_000_000n)), "mainnet")).toMatchObject({
      kind: "deposit",
      counterparty: OWNER,
      amount: "250000000",
      detail: null,
    });
  });

  it("v4 payee_cap and monthly carry their limit as the amount", () => {
    expect(toEventRow(event([sym("payee_cap"), b64(addr(OWNER))], i128(9n)), "mainnet")).toMatchObject({
      kind: "payee_cap",
      counterparty: OWNER,
      amount: "9",
      detail: null,
    });
    expect(toEventRow(event([sym("monthly")], i128(7n)), "mainnet")).toMatchObject({
      kind: "monthly",
      counterparty: null,
      amount: "7",
      detail: null,
    });
  });

  it("v4 budget: (budget, agent) -> (valid_until, limit, payees) keeps the agent, cap, expiry and payees", () => {
    const value = xdr.ScVal.scvVec([
      nativeToScVal(1_800_000_000n, { type: "u64" }),
      i128(30_000_000n),
      xdr.ScVal.scvVec([addr(TREASURY), addr(OWNER)]),
    ]);
    expect(toEventRow(event([sym("budget"), b64(addr(OWNER))], value), "mainnet")).toMatchObject({
      kind: "budget",
      counterparty: OWNER,
      amount: "30000000",
      detail: {
        valid_until: 1_800_000_000,
        payees: [TREASURY, OWNER],
      },
    });
  });

  it("paused: records whether the treasury was paused or resumed in detail", () => {
    expect(toEventRow(event([sym("paused")], xdr.ScVal.scvBool(true)), "mainnet")).toMatchObject({
      kind: "paused",
      counterparty: null,
      amount: null,
      detail: { paused: true },
    });
    expect(toEventRow(event([sym("paused")], xdr.ScVal.scvBool(false)), "mainnet")).toMatchObject({
      kind: "paused",
      counterparty: null,
      amount: null,
      detail: { paused: false },
    });
  });
});
