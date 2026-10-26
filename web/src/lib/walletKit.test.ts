import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  kitMock,
  logFunnelMock,
  makePasskeyWalletMock,
  realPasskeyBackendMock,
  resetPasskeyBackendMock,
  relayEnvelopeMock,
  relayTxMock,
  relayHostFunctionMock,
  ledgerConfirmMock,
  deployFromSmartWalletMock,
  transferFromSmartWalletMock,
  invokeFromSmartWalletMock,
  activateRecoverySignerMock,
  recoverWalletMock,
} = vi.hoisted(() => ({
  kitMock: {
    init: vi.fn(),
    setTheme: vi.fn(),
    setWallet: vi.fn().mockResolvedValue(undefined),
    authModal: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined),
    signTransaction: vi.fn(),
  },
  logFunnelMock: vi.fn(),
  makePasskeyWalletMock: vi.fn(),
  realPasskeyBackendMock: vi.fn().mockResolvedValue({ kind: "backend" }),
  resetPasskeyBackendMock: vi.fn(),
  relayEnvelopeMock: vi.fn().mockResolvedValue({ hash: "tx_env" }),
  relayTxMock: vi.fn().mockResolvedValue({ hash: "tx_relayed" }),
  relayHostFunctionMock: vi.fn().mockResolvedValue({ hash: "tx_host" }),
  ledgerConfirmMock: vi.fn().mockReturnValue(vi.fn()),
  deployFromSmartWalletMock: vi.fn().mockResolvedValue("CDEPLOYED"),
  transferFromSmartWalletMock: vi.fn().mockResolvedValue(undefined),
  invokeFromSmartWalletMock: vi.fn().mockResolvedValue({ hash: "tx_invoke" }),
  activateRecoverySignerMock: vi.fn().mockResolvedValue(undefined),
  recoverWalletMock: vi.fn(),
}));

vi.mock("@creit.tech/stellar-wallets-kit", () => ({
  StellarWalletsKit: kitMock,
  Networks: { PUBLIC: "Public Global Stellar Network ; September 2015" },
}));

vi.mock("./funnel", () => ({
  currentDevice: () => "desktop",
  logFunnel: logFunnelMock,
}));

vi.mock("./passkey", () => ({
  makePasskeyWallet: makePasskeyWalletMock,
  realPasskeyBackend: realPasskeyBackendMock,
  resetPasskeyBackend: resetPasskeyBackendMock,
}));

vi.mock("./relayer", () => ({
  relayEnvelope: relayEnvelopeMock,
  relayTx: relayTxMock,
  relayHostFunction: relayHostFunctionMock,
  ledgerConfirm: ledgerConfirmMock,
}));

vi.mock("./smartWalletTx", () => ({
  deployFromSmartWallet: deployFromSmartWalletMock,
  transferFromSmartWallet: transferFromSmartWalletMock,
  invokeFromSmartWallet: invokeFromSmartWalletMock,
}));

vi.mock("./recoveryFlow", () => ({
  activateRecoverySigner: activateRecoverySignerMock,
  recoverWallet: recoverWalletMock,
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

const sessionStore = makeStorage();
const localStore = makeStorage();
vi.stubGlobal("sessionStorage", sessionStore);
vi.stubGlobal("localStorage", localStore);

import {
  activateRecovery,
  connect,
  connectPasskey,
  connectPasskeyRecovery,
  disconnect,
  executorFor,
  getAddress,
  isPasskeySession,
  onAddressChange,
  passkeyLabel,
  walletSignerFor,
} from "./walletKit";

describe("walletKit", () => {
  beforeEach(async () => {
    sessionStore.clear();
    localStore.clear();
    vi.clearAllMocks();
    await disconnect();
    vi.clearAllMocks();
  });

  it("formats passkey labels with date and time", () => {
    const label = passkeyLabel(new Date("2026-10-24T14:05:00Z"));
    expect(label).toMatch(/^Eunomia · \d{2} Oct \d{2}:\d{2}$/);
  });

  it("connects via StellarWalletsKit.authModal, persists session, notifies listeners, and logs funnel success", async () => {
    const seen: Array<string | null> = [];
    const unsub = onAddressChange((addr) => seen.push(addr));
    kitMock.authModal.mockResolvedValueOnce({ address: "GOWNER123", walletId: "freighter" });

    const addr = await connect();
    expect(addr).toBe("GOWNER123");
    expect(getAddress()).toBe("GOWNER123");
    expect(sessionStore.getItem("prism_wallet_address")).toBe("GOWNER123");
    expect(sessionStore.getItem("prism_wallet_id")).toBe("freighter");
    expect(seen).toEqual(["GOWNER123"]);
    expect(logFunnelMock).toHaveBeenCalledWith({ event: "connect_click" });
    expect(logFunnelMock).toHaveBeenCalledWith({
      event: "connect_result",
      outcome: "success",
      walletId: "freighter",
    });

    await disconnect();
    expect(getAddress()).toBeNull();
    expect(sessionStore.getItem("prism_wallet_address")).toBeNull();
    expect(seen).toEqual(["GOWNER123", null]);
    unsub();
  });

  it("logs dismissed funnel event and throws when authModal resolves without an address", async () => {
    kitMock.authModal.mockResolvedValueOnce({});
    await expect(connect()).rejects.toThrow("No wallet selected.");
    expect(logFunnelMock).toHaveBeenCalledWith({
      event: "connect_result",
      outcome: "dismissed",
    });
  });

  it("logs error funnel event and rethrows when authModal rejects", async () => {
    kitMock.authModal.mockRejectedValueOnce(new Error("User rejected"));
    await expect(connect()).rejects.toThrow("User rejected");
    expect(logFunnelMock).toHaveBeenCalledWith({
      event: "connect_result",
      outcome: "error",
      detail: "User rejected",
    });
  });

  it("creates and connects passkey smart wallets, relays deployment, and persists passkey session", async () => {
    const walletInstance = {
      create: vi.fn().mockResolvedValue({
        contractId: "CPASSKEY1",
        keyId: "key_1",
        signedTx: "AAAA_SIGNED_XDR",
      }),
      connect: vi.fn().mockResolvedValue({
        contractId: "CPASSKEY2",
        keyId: "key_2",
      }),
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      signAuthEntry: vi.fn(),
    };
    makePasskeyWalletMock.mockReturnValue(walletInstance);

    const createdAddr = await connectPasskey("create", "Eunomia · test");
    expect(createdAddr).toBe("CPASSKEY1");
    expect(walletInstance.create).toHaveBeenCalledWith("Eunomia · test");
    expect(relayEnvelopeMock).toHaveBeenCalledWith(expect.any(Function), "AAAA_SIGNED_XDR", expect.any(Function));
    expect(isPasskeySession()).toBe(true);
    expect(getAddress()).toBe("CPASSKEY1");

    const reconnectedAddr = await connectPasskey("connect");
    expect(reconnectedAddr).toBe("CPASSKEY2");
    expect(walletInstance.connect).toHaveBeenCalled();
    expect(getAddress()).toBe("CPASSKEY2");
  });

  it("supports recovery signer activation and wallet recovery", async () => {
    const walletInstance = {
      ensureConnected: vi.fn().mockResolvedValue(undefined),
    };
    makePasskeyWalletMock.mockReturnValue(walletInstance);
    sessionStore.setItem("prism_passkey_key_id", "key_saved");

    await activateRecovery("GRECOVERY", "CWALLET");
    expect(walletInstance.ensureConnected).toHaveBeenCalledWith("key_saved");
    expect(activateRecoverySignerMock).toHaveBeenCalledWith(
      expect.objectContaining({ wallet: walletInstance }),
      "GRECOVERY",
      "CWALLET",
    );

    recoverWalletMock.mockResolvedValueOnce({ contractId: "CRECOVERED", keyId: "key_new" });
    const recovered = await connectPasskeyRecovery("secret-words", "Eunomia · rec");
    expect(recovered).toBe("CRECOVERED");
    expect(getAddress()).toBe("CRECOVERED");
    expect(isPasskeySession()).toBe(true);
  });

  it("builds a wallet executor for classic sessions and a passkey executor for passkey sessions", async () => {
    const walletExec = await executorFor("GCLASSIC");
    expect(walletExec.kind).toBe("wallet");
    expect(walletExec.address).toBe("GCLASSIC");

    const signer = walletSignerFor("GCLASSIC");
    expect(typeof signer.signTransaction).toBe("function");

    const walletInstance = {
      ensureConnected: vi.fn().mockResolvedValue(undefined),
      signAuthEntry: vi.fn(),
    };
    makePasskeyWalletMock.mockReturnValue(walletInstance);
    sessionStore.setItem("prism_wallet_id", "passkey");
    sessionStore.setItem("prism_passkey_key_id", "key_p");

    const passkeyExec = await executorFor("CSMART");
    expect(passkeyExec.kind).toBe("passkey");
    expect(passkeyExec.address).toBe("CSMART");
    expect(walletInstance.ensureConnected).toHaveBeenCalledWith("key_p");
  });
});
