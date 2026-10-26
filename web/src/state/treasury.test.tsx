import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XLM_SAC } from "../config";
import { createHookTestHarness, hookMocks } from "../test-stubs/hookRunner";
import type { TreasuryContextValue } from "./treasuryContext";

const OWNER = Keypair.random().publicKey();
const PAYEE = Keypair.random().publicKey();
const AGENT = Keypair.random().publicKey();
const T1 = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";
const T2 = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";

const {
  toastMock,
  addressRef,
  kitConnectMock,
  executorForMock,
  createTreasuryMock,
  makeTreasuryMock,
  readStateMock,
  runsTreasuryCodeMock,
  readLifecycleMock,
  fundTreasuryMock,
  addPayeeMock,
  removePayeeMock,
  payMock,
  registerAgentKeyMock,
  setTaskBudgetMock,
  revokeSessionMock,
  setPausedMock,
  adminWithdrawMock,
  setLimitsMock,
  setMonthlyLimitMock,
  setPayeeCapMock,
  discoverTreasuriesMock,
  registerTreasuryMock,
  getXlmBalanceMock,
  logActivityMock,
} = vi.hoisted(() => ({
  toastMock: vi.fn(),
  addressRef: { current: null as string | null },
  kitConnectMock: vi.fn(),
  executorForMock: vi.fn().mockResolvedValue({ kind: "wallet", address: "G", signer: {}, submit: vi.fn() }),
  createTreasuryMock: vi.fn(),
  makeTreasuryMock: vi.fn().mockReturnValue({ client: {}, submit: vi.fn() }),
  readStateMock: vi.fn(),
  runsTreasuryCodeMock: vi.fn(),
  readLifecycleMock: vi.fn(),
  fundTreasuryMock: vi.fn(),
  addPayeeMock: vi.fn(),
  removePayeeMock: vi.fn(),
  payMock: vi.fn(),
  registerAgentKeyMock: vi.fn(),
  setTaskBudgetMock: vi.fn(),
  revokeSessionMock: vi.fn(),
  setPausedMock: vi.fn(),
  adminWithdrawMock: vi.fn(),
  setLimitsMock: vi.fn(),
  setMonthlyLimitMock: vi.fn(),
  setPayeeCapMock: vi.fn(),
  discoverTreasuriesMock: vi.fn(),
  registerTreasuryMock: vi.fn(),
  getXlmBalanceMock: vi.fn().mockResolvedValue(100),
  logActivityMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, ...hookMocks };
});

vi.mock("./toastContext", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("../lib/useWalletAddress", () => ({
  useWalletAddress: () => addressRef.current,
}));

vi.mock("../lib/walletKit", () => ({
  connect: kitConnectMock,
  executorFor: executorForMock,
}));

vi.mock("../lib/createTreasury", () => ({
  createTreasury: createTreasuryMock,
}));

vi.mock("../lib/userTreasury", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/userTreasury")>();
  return {
    ...actual,
    makeTreasury: makeTreasuryMock,
    readState: readStateMock,
    runsTreasuryCode: runsTreasuryCodeMock,
    readLifecycle: readLifecycleMock,
    fundTreasury: fundTreasuryMock,
    addPayee: addPayeeMock,
    removePayee: removePayeeMock,
    pay: payMock,
    setTaskBudget: setTaskBudgetMock,
    revokeSession: revokeSessionMock,
    setPaused: setPausedMock,
    adminWithdraw: adminWithdrawMock,
    setLimits: setLimitsMock,
    setMonthlyLimit: setMonthlyLimitMock,
    setPayeeCap: setPayeeCapMock,
  };
});

vi.mock("../lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/session")>();
  return {
    ...actual,
    registerAgentKey: registerAgentKeyMock,
  };
});

vi.mock("../lib/registry", () => ({
  discoverTreasuries: discoverTreasuriesMock,
  registerTreasury: registerTreasuryMock,
}));

vi.mock("../lib/funding", () => ({
  getXlmBalance: getXlmBalanceMock,
  getContractXlmBalance: getXlmBalanceMock,
}));

vi.mock("../lib/activity", () => ({
  logActivity: logActivityMock,
}));

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

const localStore = makeStorage();
vi.stubGlobal("localStorage", localStore);

import { clearTreasuryId, setTreasuryId } from "../lib/treasuryStore";
import { TreasuryProvider } from "./treasury";

function mountProvider() {
  return createHookTestHarness(
    () =>
      (
        TreasuryProvider({ children: null }) as unknown as {
          props: { value: TreasuryContextValue };
        }
      ).props.value,
    {},
  );
}

describe("TreasuryProvider", () => {
  beforeEach(() => {
    localStore.clear();
    vi.clearAllMocks();
    addressRef.current = OWNER;
    discoverTreasuriesMock.mockResolvedValue([]);
    runsTreasuryCodeMock.mockResolvedValue(true);
    readStateMock.mockResolvedValue({
      balance: 500_000_000n,
      daySpent: 100_000_000n,
      dailyLimit: 200_000_000n,
      perTaskLimit: 50_000_000n,
      admin: OWNER,
      agent: OWNER,
      token: XLM_SAC,
    });
    readLifecycleMock.mockResolvedValue({
      paused: false,
      session: null,
      v4: {
        month: 24322,
        monthlyLimit: 1_000_000_000n,
        monthSpent: 100_000_000n,
        depositCap: 2_500_000_000n,
        sessionPayees: [],
      },
    });
  });

  it("auto-adopts the latest treasury discovered in the registry on a fresh device", async () => {
    discoverTreasuriesMock.mockResolvedValueOnce([T1, T2]);
    const h = mountProvider();

    await vi.waitFor(() => {
      expect(h.result.treasuryId).toBe(T2);
    });
    expect(h.result.state?.balance).toBe(500_000_000n);
    expect(toastMock).toHaveBeenCalledWith("success", expect.stringContaining("Recovered your treasury"));
    h.unmount();
  });

  it("refuses a treasury that does not run the shipped wasm or is owned by a different wallet", async () => {
    setTreasuryId(OWNER, T1);
    runsTreasuryCodeMock.mockResolvedValueOnce(false);
    const h = mountProvider();

    await vi.waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        "error",
        "That contract isn't a Eunomia treasury, so it wasn't opened.",
      );
    });
    expect(h.result.treasuryId).toBeNull();
    h.unmount();
  });

  it("validates and executes deploy, openExisting, switchTreasury, and forgetTreasury", async () => {
    const h = mountProvider();

    // Validation failures
    expect((await h.result.deploy("", "10")).validation).toBe(true);
    expect((await h.result.deploy("10", "50")).validation).toBe(true); // perTask > daily
    expect((await h.result.deploy("50", "10", { payee: "not-an-address" })).validation).toBe(true);
    expect((await h.result.deploy("50", "10", { agentKey: "bad-key" })).validation).toBe(true);

    // Successful deploy
    createTreasuryMock.mockResolvedValueOnce(T1);
    const deployed = await h.result.deploy("50", "10", {
      payee: PAYEE,
      agentKey: AGENT,
      capXlm: "25",
      hours: "12",
      fundXlm: "20",
    });
    expect(deployed.ok).toBe(true);
    expect(h.result.treasuryId).toBe(T1);

    // openExisting validation + success
    expect(h.result.openExisting("").validation).toBe(true);
    expect(h.result.openExisting("invalid-contract").validation).toBe(true);
    expect(h.result.openExisting(T2).ok).toBe(true);
    expect(h.result.treasuryId).toBe(T2);

    // switchTreasury back to T1 and forget T2
    h.result.switchTreasury(T1);
    expect(h.result.treasuryId).toBe(T1);
    h.result.forgetTreasury(T2);
    expect(h.result.treasuries.map((t) => t.id)).toEqual([T1]);

    h.unmount();
  });

  it("executes fund, whitelist, removePayeeAddr, spend, Leash, lifecycle, and limit actions", async () => {
    setTreasuryId(OWNER, T1);
    const h = mountProvider();
    await vi.waitFor(() => {
      expect(h.result.state).not.toBeNull();
    });

    // fund
    expect((await h.result.fund("-5")).validation).toBe(true);
    fundTreasuryMock.mockResolvedValueOnce("tx_fund");
    expect((await h.result.fund("25")).ok).toBe(true);

    // whitelist & removePayeeAddr
    expect((await h.result.whitelist("")).validation).toBe(true);
    addPayeeMock.mockResolvedValueOnce(undefined);
    expect((await h.result.whitelist(PAYEE)).ok).toBe(true);
    removePayeeMock.mockResolvedValueOnce(undefined);
    expect((await h.result.removePayeeAddr(PAYEE)).ok).toBe(true);

    // spend: allowed and policy-rejected
    payMock.mockResolvedValueOnce({ ok: true, hash: "tx_pay" });
    expect((await h.result.spend(PAYEE, "5")).ok).toBe(true);

    payMock.mockResolvedValueOnce({ ok: false, errorMessage: "Payee not whitelisted" });
    const rejected = await h.result.spend(PAYEE, "5");
    expect(rejected.ok).toBe(false);
    expect(rejected.msg).toContain("Blocked by policy");

    // startLeash, approveBudget, revokeLeash
    expect((await h.result.startLeash("20", "12", "")).validation).toBe(true);
    registerAgentKeyMock.mockResolvedValueOnce({ ok: true, hash: "tx_leash" });
    expect((await h.result.startLeash("20", "12", AGENT)).ok).toBe(true);

    setTaskBudgetMock.mockResolvedValueOnce({ ok: true, hash: "tx_budget" });
    expect(
      (
        await h.result.approveBudget({
          network: "pubnet",
          treasury: T1,
          agent: AGENT,
          limit: 50_000_000n,
          hours: 4,
          payees: [PAYEE],
          task: "audit",
          expires: Math.floor(Date.now() / 1000) + 3600,
        })
      ).ok,
    ).toBe(true);

    revokeSessionMock.mockResolvedValueOnce({ ok: true, hash: "tx_rev" });
    expect((await h.result.revokeLeash()).ok).toBe(true);

    // togglePause, withdraw, updateLimits, updateMonthly, capPayee, registerActive
    setPausedMock.mockResolvedValueOnce({ ok: true, hash: "tx_pause" });
    expect((await h.result.togglePause()).ok).toBe(true);

    adminWithdrawMock.mockResolvedValueOnce({ ok: true, hash: "tx_wd" });
    expect((await h.result.withdraw("", "10")).ok).toBe(true);

    setLimitsMock.mockResolvedValueOnce({ ok: true, hash: "tx_lim" });
    expect((await h.result.updateLimits("100", "20")).ok).toBe(true);

    setMonthlyLimitMock.mockResolvedValueOnce({ ok: true, hash: "tx_mon" });
    expect((await h.result.updateMonthly("500")).ok).toBe(true);

    setPayeeCapMock.mockResolvedValueOnce({ ok: true, hash: "tx_cap" });
    expect((await h.result.capPayee(PAYEE, "50")).ok).toBe(true);

    registerTreasuryMock.mockResolvedValueOnce(undefined);
    expect((await h.result.registerActive()).ok).toBe(true);

    clearTreasuryId(OWNER);
    h.unmount();
  });
});
