import { describe, it, expect, vi } from "vitest";
import { Account, Address, Contract, Keypair, nativeToScVal, Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import {
  confirmAssembledTx,
  describeHostFunction,
  setActiveTokenCode,
  subscribeTxConfirmation,
  type PendingTxConfirmation,
} from "./txSummary";
import { makePasskeyExecutor, makeWalletExecutor } from "./executor";

const TREASURY = "CCU3NHMJGYNFNGWH5IZ3RTE7PPETD7QVVWK2H6DIQCFJKGXGLKKRHWO7";
const PAYEE_1 = Keypair.random().publicKey();
const PAYEE_2 = "GDPKXL6CNHUXBV4PM54CPTRZNQRYVTIMO4YGBW3M2MNSCMQ7TTNINXP6";
const AGENT = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const WALLET_C = "CAYWNXHANRY5GSJAZOR4YTKBKNOKTCITE52ZRKDKCAWLDTYWFFVFSPAZ";

function callFn(contractId: string, method: string, ...args: xdr.ScVal[]): xdr.HostFunction {
  return new Contract(contractId)
    .call(method, ...args)
    .body()
    .invokeHostFunctionOp()
    .hostFunction();
}

describe("describeHostFunction", () => {
  it("decodes admin_withdraw / withdraw with full addresses and never shortens them", () => {
    const fn = callFn(
      TREASURY,
      "admin_withdraw",
      new Address(PAYEE_1).toScVal(),
      nativeToScVal(250_000_000n, { type: "i128" }),
    );
    const summary = describeHostFunction(fn, { token: "USDC" });
    expect(summary).toBe(`admin_withdraw(to=${PAYEE_1}, 25 USDC) on treasury ${TREASURY}`);
    expect(summary).toContain(PAYEE_1);
    expect(summary).toContain(TREASURY);
    expect(summary).not.toContain("…");

    const withdrawFn = callFn(
      TREASURY,
      "withdraw",
      new Address(PAYEE_1).toScVal(),
      nativeToScVal(250_000_000n, { type: "i128" }),
    );
    expect(describeHostFunction(withdrawFn, { token: "USDC" })).toBe(
      `withdraw(to=${PAYEE_1}, 25 USDC) on treasury ${TREASURY}`,
    );
  });

  it("decodes set_limits with daily and per-payment limits and full treasury address", () => {
    const fn = callFn(
      TREASURY,
      "set_limits",
      nativeToScVal(1_000_000_000n, { type: "i128" }),
      nativeToScVal(250_000_000n, { type: "i128" }),
    );
    const summary = describeHostFunction(fn, { token: "XLM" });
    expect(summary).toBe(
      `set_limits(daily_limit=100 XLM, per_task_limit=25 XLM) on treasury ${TREASURY}`,
    );
    expect(summary).not.toContain("…");
  });

  it("decodes add_payee and remove_payee with full payee and treasury addresses", () => {
    const addFn = callFn(TREASURY, "add_payee", new Address(PAYEE_1).toScVal());
    expect(describeHostFunction(addFn)).toBe(`add_payee(payee=${PAYEE_1}) on treasury ${TREASURY}`);

    const removeFn = callFn(TREASURY, "remove_payee", new Address(PAYEE_1).toScVal());
    expect(describeHostFunction(removeFn)).toBe(
      `remove_payee(payee=${PAYEE_1}) on treasury ${TREASURY}`,
    );
  });

  it("decodes set_agent and set_session with full agent and treasury addresses", () => {
    const setAgentFn = callFn(TREASURY, "set_agent", new Address(AGENT).toScVal());
    expect(describeHostFunction(setAgentFn)).toBe(
      `set_agent(agent=${AGENT}) on treasury ${TREASURY}`,
    );

    const setSessionFn = callFn(
      TREASURY,
      "set_session",
      new Address(AGENT).toScVal(),
      nativeToScVal(1_700_000_000n, { type: "u64" }),
      nativeToScVal(500_000_000n, { type: "i128" }),
    );
    expect(describeHostFunction(setSessionFn, { token: "XLM" })).toBe(
      `set_session(agent=${AGENT}, limit=50 XLM, valid_until=1700000000) on treasury ${TREASURY}`,
    );
  });

  it("decodes set_task_budget with full agent, payees, and treasury addresses", () => {
    const payeesVec = xdr.ScVal.scvVec([
      new Address(PAYEE_1).toScVal(),
      new Address(PAYEE_2).toScVal(),
    ]);
    const fn = callFn(
      TREASURY,
      "set_task_budget",
      new Address(AGENT).toScVal(),
      nativeToScVal(1_700_003_600n, { type: "u64" }),
      nativeToScVal(400_000_000n, { type: "i128" }),
      payeesVec,
    );
    const summary = describeHostFunction(fn, { token: "USDC" });
    expect(summary).toBe(
      `set_task_budget(agent=${AGENT}, limit=40 USDC, valid_until=1700003600, payees=[${PAYEE_1}, ${PAYEE_2}]) on treasury ${TREASURY}`,
    );
    expect(summary).toContain(AGENT);
    expect(summary).toContain(PAYEE_1);
    expect(summary).toContain(PAYEE_2);
    expect(summary).toContain(TREASURY);
    expect(summary).not.toContain("…");
  });

  it("decodes set_payee_cap with full payee and treasury addresses", () => {
    const fn = callFn(
      TREASURY,
      "set_payee_cap",
      new Address(PAYEE_1).toScVal(),
      nativeToScVal(1_200_000_000n, { type: "i128" }),
    );
    const summary = describeHostFunction(fn, { token: "XLM" });
    expect(summary).toBe(
      `set_payee_cap(payee=${PAYEE_1}, cap=120 XLM) on treasury ${TREASURY}`,
    );
    expect(summary).not.toContain("…");
  });

  it("decodes pay, deposit, set_monthly_limit, set_paused, and revoke_session", () => {
    setActiveTokenCode("XLM");
    const payFn = callFn(
      TREASURY,
      "pay",
      nativeToScVal(42n, { type: "u64" }),
      new Address(PAYEE_1).toScVal(),
      nativeToScVal(150_000_000n, { type: "i128" }),
    );
    expect(describeHostFunction(payFn)).toBe(
      `pay(to=${PAYEE_1}, 15 XLM, task_id=42) on treasury ${TREASURY}`,
    );

    const depositFn = callFn(
      TREASURY,
      "deposit",
      new Address(PAYEE_1).toScVal(),
      nativeToScVal(300_000_000n, { type: "i128" }),
    );
    expect(describeHostFunction(depositFn)).toBe(
      `deposit(from=${PAYEE_1}, 30 XLM) on treasury ${TREASURY}`,
    );

    const monthlyFn = callFn(
      TREASURY,
      "set_monthly_limit",
      nativeToScVal(5_000_000_000n, { type: "i128" }),
    );
    expect(describeHostFunction(monthlyFn)).toBe(
      `set_monthly_limit(limit=500 XLM) on treasury ${TREASURY}`,
    );

    const pauseFn = callFn(TREASURY, "set_paused", xdr.ScVal.scvBool(true));
    expect(describeHostFunction(pauseFn)).toBe(`set_paused(paused=true) on treasury ${TREASURY}`);

    const revokeFn = callFn(TREASURY, "revoke_session");
    expect(describeHostFunction(revokeFn)).toBe(`revoke_session() on treasury ${TREASURY}`);
  });
});

describe("transaction confirmation before passkey or wallet prompt", () => {
  function buildAssembled(fn: xdr.HostFunction, wallet: string) {
    const entry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(wallet).toScAddress(),
          nonce: xdr.Int64.fromString("1"),
          signatureExpirationLedger: 0,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          fn.invokeContract(),
        ),
        subInvocations: [],
      }),
    });
    return new TransactionBuilder(new Account(PAYEE_2, "0"), {
      fee: "100",
      networkPassphrase: "Test SDF Network ; September 2015",
    })
      .addOperation(Operation.invokeHostFunction({ func: fn, auth: [entry] }))
      .setTimeout(180)
      .build();
  }

  it("pauses wallet and passkey signing until confirmed in the BottomSheet, and aborts on cancel", async () => {
    let currentPending: PendingTxConfirmation | null = null;
    const unsub = subscribeTxConfirmation((p) => {
      currentPending = p;
    });

    try {
      const fn = callFn(TREASURY, "add_payee", new Address(PAYEE_1).toScVal());
      const built = buildAssembled(fn, WALLET_C);

      const signAndSend = vi.fn().mockResolvedValue({ sendTransactionResponse: { hash: "h1" } });
      const walletEx = makeWalletExecutor(PAYEE_1, { signTransaction: vi.fn() });

      const submitPromise = walletEx.submit({ signAndSend, built });
      expect(currentPending).not.toBeNull();
      expect(currentPending!.summary).toBe(`add_payee(payee=${PAYEE_1}) on treasury ${TREASURY}`);
      expect(signAndSend).not.toHaveBeenCalled();

      currentPending!.confirm();
      await expect(submitPromise).resolves.toEqual({ hash: "h1" });
      expect(signAndSend).toHaveBeenCalledTimes(1);

      // Now test cancellation on the passkey path: wallet.sign is never called.
      const passkeySign = vi.fn();
      const passkeyEx = makePasskeyExecutor(
        WALLET_C,
        {
          create: vi.fn(),
          connect: vi.fn(),
          ensureConnected: vi.fn(),
          sign: passkeySign,
          signAuthEntry: vi.fn(),
          createKey: vi.fn(),
          addRecoverySigner: vi.fn(),
          addPasskeyFromRecovery: vi.fn(),
          connectRecovered: vi.fn(),
        },
        vi.fn(),
        vi.fn(),
        vi.fn(),
      );

      const cancelPromise = passkeyEx.submit({ signAndSend: vi.fn(), built });
      expect(currentPending).not.toBeNull();
      currentPending!.cancel();
      await expect(cancelPromise).rejects.toThrow(/rejected/i);
      expect(passkeySign).not.toHaveBeenCalled();
    } finally {
      unsub();
    }
  });

  it("confirmAssembledTx returns null when no assembled transaction is present", async () => {
    await expect(confirmAssembledTx({})).resolves.toBeNull();
  });
});
