import { describe, it, expect, vi } from "vitest";
import { Address, rpc, xdr } from "@stellar/stellar-sdk";
import {
  adminCancelEscrow,
  makeTreasury,
  isOwnedBy,
  isValidContractId,
  readLifecycle,
  readOpenEscrows,
  readPayeeCaps,
  refundEscrow,
  runsTreasuryCode,
  toStroops,
  TREASURY_WASM_HASH,
  XLM_SAC,
  type EunomiaState,
} from "./userTreasury";
import type { Client } from "./treasuryClient";
import type { TxExecutor } from "./executor";

const SMART_WALLET = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";
const DEPLOYED = "CCU3NHMJGYNFNGWH5IZ3RTE7PPETD7QVVWK2H6DIQCFJKGXGLKKRHWO7";

describe("makeTreasury", () => {
  const executor = (address: string, kind: "wallet" | "passkey") =>
    ({
      address,
      kind,
      signer: { signTransaction: vi.fn() },
      submit: vi.fn(),
    }) as unknown as TxExecutor;

  it("does not hand a smart wallet address to the contract client", () => {
    // The regression: the client resolves publicKey with getAccount(), and a C-address comes
    // back "invalid version byte. expected 48, got 16" — so every read on a passkey user's
    // treasury failed and the UI reported the treasury might not exist.
    const t = makeTreasury(DEPLOYED, executor(SMART_WALLET, "passkey"));
    expect((t.client.options as { publicKey?: string }).publicKey).toBeUndefined();
  });

  it("keeps handing a wallet session its own address", () => {
    const g = "GDPKXL6CNHUXBV4PM54CPTRZNQRYVTIMO4YGBW3M2MNSCMQ7TTNINXP6";
    const t = makeTreasury(DEPLOYED, executor(g, "wallet"));
    expect((t.client.options as { publicKey?: string }).publicKey).toBe(g);
  });
});

describe("isValidContractId", () => {
  it("accepts a real contract id", () => {
    expect(isValidContractId(XLM_SAC)).toBe(true);
  });

  it("rejects wallet addresses, truncated ids, and junk", () => {
    expect(isValidContractId("GDPKXL6CNHUXBV4PM54CPTRZNQRYVTIMO4YGBW3M2MNSCMQ7TTNINXP6")).toBe(false);
    expect(isValidContractId(XLM_SAC.slice(0, 30))).toBe(false);
    expect(isValidContractId("not-a-contract")).toBe(false);
    expect(isValidContractId("")).toBe(false);
  });
});

describe("toStroops", () => {
  it("converts whole XLM to 7-decimal stroops", () => {
    expect(toStroops(1)).toBe(10_000_000n);
    expect(toStroops(50)).toBe(500_000_000n);
  });

  it("handles fractional XLM without float drift", () => {
    expect(toStroops(1.5)).toBe(15_000_000n);
    expect(toStroops(0.1)).toBe(1_000_000n);
    expect(toStroops(0.0000001)).toBe(1n);
  });

  it("returns 0n for zero", () => {
    expect(toStroops(0)).toBe(0n);
  });

  it("rejects negative or non-finite amounts", () => {
    expect(() => toStroops(-1)).toThrow();
    expect(() => toStroops(NaN)).toThrow();
    expect(() => toStroops(Infinity)).toThrow();
  });
});

describe("readLifecycle", () => {
  it("returns the pause flag and session from a v3 treasury", async () => {
    const fake = {
      is_paused: async () => ({ result: true }),
      get_session: async () => ({ result: undefined }),
    } as unknown as Client;
    expect(await readLifecycle({ client: fake, submit: async () => ({}) })).toEqual({ paused: true, session: null, v4: null });
  });

  it("reads the v4 limits when the treasury has them", async () => {
    const fake = {
      is_paused: async () => ({ result: false }),
      get_session: async () => ({ result: undefined }),
      this_month: async () => ({ result: 24_321 }),
      monthly_limit: async () => ({ result: 300n }),
      month_spent: async ({ month }: { month: number }) => ({ result: month === 24_321 ? 120n : 0n }),
      deposit_cap: async () => ({ result: 10_000n }),
      session_payees: async () => ({ result: ["GPAYEE"] }),
    } as unknown as Client;
    expect((await readLifecycle({ client: fake, submit: async () => ({}) }))?.v4).toEqual({
      month: 24_321,
      monthlyLimit: 300n,
      monthSpent: 120n,
      depositCap: 10_000n,
      sessionPayees: ["GPAYEE"],
    });
  });

  it("returns null on a pre-M2 treasury (probe failure = legacy signal)", async () => {
    const legacyTreasury = {
      is_paused: async () => {
        throw new Error("HostError: Error(WasmVm, MissingValue)"); // fn not in the old wasm
      },
      get_session: async () => {
        throw new Error("HostError: Error(WasmVm, MissingValue)");
      },
    } as unknown as Client;
    expect(await readLifecycle({ client: legacyTreasury, submit: async () => ({}) })).toBeNull();
  });
});

// --- H2 (2026-08-05 audit): registry poisoning ---------------------------------
describe("isOwnedBy", () => {
  const ME = "GBGHXQXR7BQZMZ3EPWXVMBNVFHXHVZQJPVWQGCTLPXQHRTFHXQXR7BQZ";
  const THEM = "GDPKXL6CNHUXBV4PM54CPTRZNQRYVTIMO4YGBW3M2MNSCMQ7TTNINXP6";

  it("accepts a treasury whose on-chain admin is the connected wallet", () => {
    expect(isOwnedBy({ admin: ME } as EunomiaState, ME)).toBe(true);
  });

  // TreasuryRegistry.register() records an unverified claim: anyone can register
  // ANY contract address under their own name, and the app auto-adopts the newest
  // entry on a fresh device. Without this check a single signature on a
  // zero-value "back up your treasury" call could point a victim at a treasury
  // the attacker administers - and the victim would fund it.
  it("rejects a treasury administered by somebody else", () => {
    expect(isOwnedBy({ admin: THEM } as EunomiaState, ME)).toBe(false);
  });

  it("rejects rather than assumes when there is no state to check", () => {
    expect(isOwnedBy(null, ME)).toBe(false);
  });

  it("rejects when no wallet is connected", () => {
    expect(isOwnedBy({ admin: ME } as EunomiaState, null)).toBe(false);
  });
});

// A contract can say anything about its admin; it cannot choose the code hash in its own
// instance entry. That is what decides whether the app believes the rest.
describe("runsTreasuryCode", () => {
  const instanceOf = (executable: xdr.ContractExecutable) => ({
    latestLedger: 1,
    entries: [
      {
        val: xdr.LedgerEntryData.contractData(
          new xdr.ContractDataEntry({
            ext: new xdr.ExtensionPoint(0),
            contract: new Address(DEPLOYED).toScAddress(),
            key: xdr.ScVal.scvLedgerKeyContractInstance(),
            durability: xdr.ContractDataDurability.persistent(),
            val: xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({ executable, storage: null })),
          }),
        ),
      },
    ],
  });
  const answer = (r: unknown) =>
    vi.spyOn(rpc.Server.prototype, "getLedgerEntries").mockResolvedValueOnce(r as rpc.Api.GetLedgerEntriesResponse);

  it("accepts the treasury code the factory ships", async () => {
    answer(instanceOf(xdr.ContractExecutable.contractExecutableWasm(Buffer.from(TREASURY_WASM_HASH, "hex"))));
    await expect(runsTreasuryCode(DEPLOYED)).resolves.toBe(true);
  });

  it("refuses any other code, however it describes itself", async () => {
    answer(instanceOf(xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 7))));
    await expect(runsTreasuryCode(DEPLOYED)).resolves.toBe(false);
  });

  it("refuses an asset contract and an id with nothing behind it", async () => {
    answer(instanceOf(xdr.ContractExecutable.contractExecutableStellarAsset()));
    await expect(runsTreasuryCode(DEPLOYED)).resolves.toBe(false);
    answer({ latestLedger: 1, entries: [] });
    await expect(runsTreasuryCode(DEPLOYED)).resolves.toBe(false);
  });
});

describe("readPayeeCaps", () => {
  it("reads each unique payee's monthly cap and spend for the given month", async () => {
    const caps: Record<string, bigint> = { GPAYEE1: 500n, GPAYEE2: 0n };
    const spents: Record<string, bigint> = { "GPAYEE1:24321": 125n, "GPAYEE2:24321": 40n };
    const fake = {
      payee_cap: async ({ payee }: { payee: string }) => ({ result: caps[payee] ?? 0n }),
      payee_spent: async ({ payee, month }: { payee: string; month: number }) => ({
        result: spents[`${payee}:${month}`] ?? 0n,
      }),
    } as unknown as Client;

    const rows = await readPayeeCaps(
      { client: fake, submit: async () => ({}) },
      ["GPAYEE1", "GPAYEE2", "GPAYEE1"],
      24_321,
    );
    expect(rows).toEqual([
      { payee: "GPAYEE1", cap: 500n, spent: 125n },
      { payee: "GPAYEE2", cap: 0n, spent: 40n },
    ]);
  });
});

describe("escrow helpers", () => {
  it("returns empty without probing ids when locked balance is 0", async () => {
    const get_escrow = vi.fn();
    const fake = {
      locked: async () => ({ result: 0n }),
      get_escrow,
    } as unknown as Client;

    expect(await readOpenEscrows({ client: fake, submit: async () => ({}) })).toEqual({
      locked: 0n,
      escrows: [],
    });
    expect(get_escrow).not.toHaveBeenCalled();
  });

  it("scans open escrows until their amounts account for the locked balance", async () => {
    const entries: Record<string, { payee: string; amount: bigint; task_id: bigint; deadline: bigint }> = {
      "1": { payee: "GPAYEE1", amount: 100n, task_id: 7n, deadline: 1_800_000_000n },
      "3": { payee: "GPAYEE2", amount: 250n, task_id: 9n, deadline: 1_800_003_600n },
    };
    const probed: bigint[] = [];
    const fake = {
      locked: async () => ({ result: 350n }),
      get_escrow: async ({ id }: { id: bigint }) => {
        probed.push(id);
        return { result: entries[id.toString()] };
      },
    } as unknown as Client;

    const res = await readOpenEscrows({ client: fake, submit: async () => ({}) });
    expect(res).toEqual({
      locked: 350n,
      escrows: [
        { id: 1n, payee: "GPAYEE1", amount: 100n, taskId: 7n, deadline: 1_800_000_000n },
        { id: 3n, payee: "GPAYEE2", amount: 250n, taskId: 9n, deadline: 1_800_003_600n },
      ],
    });
    // Stops right after id 3 reaches the 350n locked total.
    expect(probed).toEqual([0n, 1n, 2n, 3n]);
  });

  it("submits admin_cancel_escrow and refund_escrow through the treasury executor", async () => {
    const fake = {
      admin_cancel_escrow: vi.fn(async () => ({ signAndSend: async () => ({}) })),
      refund_escrow: vi.fn(async () => ({ signAndSend: async () => ({}) })),
    } as unknown as Client;
    const submit = vi.fn(async () => ({ hash: "tx_escrow" }));

    const cancelled = await adminCancelEscrow({ client: fake, submit }, 3n);
    expect(cancelled).toEqual({ ok: true, hash: "tx_escrow" });
    expect(fake.admin_cancel_escrow).toHaveBeenCalledWith({ id: 3n });

    const refunded = await refundEscrow({ client: fake, submit }, 3n);
    expect(refunded).toEqual({ ok: true, hash: "tx_escrow" });
    expect(fake.refund_escrow).toHaveBeenCalledWith({ id: 3n });
  });
});
