// Per-user treasury operations: check that a treasury is ours and the wallet's, fund it,
// govern its policy, and spend from it — all signed by the user's wallet. Creating one goes
// through the factory (createTreasury.ts).
import {
  Address,
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { Client, type Session } from "./treasuryClient";
import { contractErr, depositErr, errText } from "./wallet-errors";
import { confirmHostFunction } from "./txSummary";
import type { SubmittableTx, TxExecutor } from "./executor";
import type { TokenCode } from "./token";
import { TREASURY_WASM_HASH } from "./treasuryWasm";
import { NETWORK_PASSPHRASE, RPC_URL, XLM_SAC } from "../config";

// The native XLM SAC — the token an XLM treasury holds and spends.
export { XLM_SAC };
// The treasury code the factory instantiates. Defined in its own module so the relay, which
// decides what it sponsors, reads the very same value; see the drift note in
// relayGuard.allowedWasmHashes.
export { TREASURY_WASM_HASH };

const XLM_UNIT = 10_000_000;

/** Whether a pasted string is a well-formed contract id (C…, 56 chars, valid checksum). */
export function isValidContractId(id: string): boolean {
  return StrKey.isValidContract(id);
}

/** XLM (float) -> i128 stroops (7 decimals), rounded to avoid float drift. */
export function toStroops(xlm: number): bigint {
  if (!Number.isFinite(xlm) || xlm < 0) {
    throw new Error("Amount must be a non-negative number.");
  }
  return BigInt(Math.round(xlm * XLM_UNIT));
}

export interface EunomiaState {
  balance: bigint;
  daySpent: bigint;
  dailyLimit: bigint;
  perTaskLimit: bigint;
  admin: string;
  agent: string;
  token: string;
}

/** Whether the connected wallet actually administers this treasury.
 *
 *  The app adopts the newest treasury registered under a wallet on a fresh device. The
 *  registry now refuses a treasury whose admin is not the owner (review H2), but it can only
 *  ask the contract, and an id can also arrive another way; so the app asks again: the
 *  treasury's own `admin` must be the wallet in hand. Paired with `runsTreasuryCode`, which
 *  makes sure the answer comes from our code. Fails closed — no state or no wallet means no. */
export function isOwnedBy(state: EunomiaState | null, wallet: string | null): boolean {
  return !!state && !!wallet && state.admin === wallet;
}

export interface PayResult {
  ok: boolean;
  hash?: string;
  errorCode?: number;
  errorMessage?: string;
  /** true = an infra/concurrency hiccup (stale sequence, RPC busy), NOT a contract
   *  guardrail rejection — safe to retry. Only the shared-agent demo path sets it. */
  transient?: boolean;
}

/** A treasury Client plus the executor that submits for it.
 *
 *  Building the transaction and submitting it are separate concerns now: a wallet session
 *  submits over the contract client's own RPC, a passkey session signs with the smart wallet
 *  and hands the result to the relay. Carrying the executor alongside the client keeps every
 *  operation below indifferent to which one is in play. */
export interface Treasury {
  client: Client;
  submit: (tx: SubmittableTx) => Promise<{ hash?: string }>;
}

/** A treasury bound to a runtime contract id + the session that owns it. */
export function makeTreasury(contractId: string, executor: TxExecutor): Treasury {
  return {
    client: new Client({
      contractId,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl: RPC_URL,
      // A smart wallet is not a classic account. The contract client resolves `publicKey`
      // with getAccount(), which answers a C-address with "invalid version byte. expected
      // 48, got 16" — so passing one made every read and write on the treasury fail before
      // it reached the chain. Left unset, the SDK simulates against its null account, which
      // is all a simulation needs. Authorisation is unaffected: the treasury requires its
      // admin to sign, and the admin is the wallet, so the auth entry still binds to it.
      ...(executor.kind === "passkey" ? {} : { publicKey: executor.address }),
      signTransaction: executor.signer.signTransaction,
    }),
    submit: executor.submit,
  };
}

/** The wasm a contract runs, read from its instance entry (hex). null when there is no such
 *  contract, or it runs no wasm (a Stellar Asset Contract).
 *
 *  What makes a treasury ours is its code, not what it says about itself: a contract written
 *  to lie can answer `get_config` with any admin it likes, pass the ownership check, and take
 *  whatever the owner deposits. The code hash is the one thing it cannot choose. */
export async function contractWasmHash(contractId: string): Promise<string | null> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const { entries } = await new rpc.Server(RPC_URL).getLedgerEntries(key);
  const exec = entries[0]?.val.contractData().val().instance().executable();
  if (!exec || exec.switch() !== xdr.ContractExecutableType.contractExecutableWasm()) return null;
  return exec.wasmHash().toString("hex");
}

/** Whether `contractId` runs the treasury code this app ships — every treasury the factory
 *  makes does. */
export async function runsTreasuryCode(contractId: string): Promise<boolean> {
  return (await contractWasmHash(contractId)) === TREASURY_WASM_HASH;
}

/** Whether this treasury runs v4 or later — read from the chain, not assumed from when it was
 *  made. A treasury without `deposit_cap` fails the simulation outright. */
async function speaksDeposit(t: Treasury): Promise<boolean> {
  try {
    const tx = await t.client.deposit_cap();
    return typeof tx.result === "bigint";
  } catch {
    return false;
  }
}

/** Fund a treasury from the session's address — a SAC transfer either way, but authorised
 *  differently.
 *
 *  A wallet is the transaction source, so its own signature covers the `from` auth. A smart
 *  wallet cannot be a source at all: it signs the auth entry instead and the relay submits.
 *  Passing its C-address to `getAccount` below is what produced "invalid version byte". */
export async function fundTreasury(
  contractId: string,
  executor: TxExecutor,
  amount: number,
  unit: TokenCode = "XLM",
): Promise<string | undefined> {
  // v4 treasuries take funding through their capped `deposit`, which moves the treasury's own
  // token — XLM or USDC alike. A bare transfer would walk straight past the beta's deposit
  // cap. Older treasuries have no `deposit` and keep the XLM transfer below.
  const t = makeTreasury(contractId, executor);
  if (await speaksDeposit(t)) {
    try {
      const { hash } = await t.submit(
        await t.client.deposit({ from: executor.address, amount: toStroops(amount) }),
      );
      return hash;
    } catch (e) {
      const why = depositErr(errText(e), unit);
      throw why ? new Error(why) : e;
    }
  }
  // A bare transfer is the pre-v4 path, and it moves native XLM only.
  if (unit !== "XLM") throw new Error("This treasury predates deposits and cannot take USDC from here.");

  if (executor.transferXlm) {
    await executor.transferXlm(contractId, toStroops(amount));
    return undefined;
  }

  const address = executor.address;
  const signer = executor.signer;
  const server = new rpc.Server(RPC_URL);
  const account = await server.getAccount(address);
  const sac = new Contract(XLM_SAC);
  const op = sac.call(
    "transfer",
    new Address(address).toScVal(),
    new Address(contractId).toScVal(),
    nativeToScVal(toStroops(amount), { type: "i128" }),
  );
  const built = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();
  const prepared = await server.prepareTransaction(built);
  await confirmHostFunction(op.body().invokeHostFunctionOp().hostFunction(), { token: unit });
  const { signedTxXdr } = await signer.signTransaction(prepared.toXDR());
  const sent = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE),
  );
  if (sent.status === "ERROR") {
    throw new Error("Stellar refused the transfer into the treasury before it reached a ledger.");
  }
  const done = await server.pollTransaction(sent.hash, { attempts: 40 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`The transfer into the treasury did not go through (${done.status}).`);
  }
  return sent.hash;
}

export async function readState(t: Treasury): Promise<EunomiaState> {
  const [bal, cfg, day] = await Promise.all([
    t.client.balance(),
    t.client.get_config(),
    t.client.day_spent(),
  ]);
  const c = cfg.result;
  return {
    balance: bal.result,
    daySpent: day.result,
    dailyLimit: c.daily_limit,
    perTaskLimit: c.per_task_limit,
    admin: c.admin,
    agent: c.agent,
    token: c.token,
  };
}

/** Read-only whitelist probe (simulation, no signature) — the chain-truth behind the
 *  "verified" badge on the derived payee list. */
export async function isPayee(t: Treasury, payee: string): Promise<boolean> {
  const tx = await t.client.is_payee({ payee });
  return tx.result;
}

export async function addPayee(t: Treasury, payee: string): Promise<void> {
  await t.submit(await t.client.add_payee({ payee }));
}

export async function removePayee(t: Treasury, payee: string): Promise<void> {
  await t.submit(await t.client.remove_payee({ payee }));
}

/** Build → sign → send a contract tx, mapping on-chain guardrail rejections
 *  to friendly messages. Shared by every state-changing treasury call. */
async function sendTx(
  build: () => Promise<SubmittableTx>,
  failMsg: string,
  submit: (tx: SubmittableTx) => Promise<{ hash?: string }>,
): Promise<PayResult> {
  try {
    const { hash } = await submit(await build());
    return { ok: true, hash };
  } catch (e) {
    const msg = errText(e);
    const ce = contractErr(msg);
    if (ce) return { ok: false, ...ce };
    return { ok: false, errorMessage: msg.slice(0, 160) || failMsg };
  }
}

/** Spend from the treasury. The contract enforces the policy and rejects violations
 *  on-chain — those rejections are the product working, surfaced as messages. */
export async function pay(
  t: Treasury,
  taskId: bigint,
  to: string,
  amountXlm: number,
): Promise<PayResult> {
  return sendTx(
    () => t.client.pay({ task_id: taskId, to, amount: toStroops(amountXlm) }),
    "Payment failed.",
    t.submit,
  );
}

// ---- M2 lifecycle ---------------------------------------------------------------

export interface Lifecycle {
  paused: boolean;
  session: Session | null;
  /** v4 limits; null on an older treasury, which has none of them */
  v4?: V4Limits | null;
}

export interface V4Limits {
  /** `year * 12 + month - 1`, UTC — the key monthly figures are stored under */
  month: number;
  /** 0 = no monthly limit */
  monthlyLimit: bigint;
  monthSpent: bigint;
  /** 0 = uncapped; fixed at deploy */
  depositCap: bigint;
  /** the payees the running Leash is restricted to; empty = any approved payee */
  sessionPayees: string[];
}

/** The v4 surfaces, or null when the treasury predates them (`this_month` is missing). */
async function readV4Limits(t: Treasury): Promise<V4Limits | null> {
  let month: number;
  try {
    month = (await t.client.this_month()).result;
  } catch {
    return null;
  }
  const [monthlyLimit, monthSpent, depositCap, sessionPayees] = await Promise.all([
    t.client.monthly_limit(),
    t.client.month_spent({ month }),
    t.client.deposit_cap(),
    t.client.session_payees(),
  ]);
  return {
    month,
    monthlyLimit: monthlyLimit.result,
    monthSpent: monthSpent.result,
    depositCap: depositCap.result,
    sessionPayees: sessionPayees.result,
  };
}

/** The v3 lifecycle state (pause flag + agent session). Returns null on a pre-M2
 *  treasury — callers treat null as "legacy: hide the session/lifecycle sections". */
export async function readLifecycle(t: Treasury): Promise<Lifecycle | null> {
  try {
    const [paused, session] = await Promise.all([t.client.is_paused(), t.client.get_session()]);
    return { paused: paused.result, session: session.result ?? null, v4: await readV4Limits(t) };
  } catch {
    return null;
  }
}

/** Freeze/unfreeze spending (owner-signed). Exit paths keep working while paused. */
export async function setPaused(t: Treasury, paused: boolean): Promise<PayResult> {
  return sendTx(() => t.client.set_paused({ paused }), "Pause toggle failed.", t.submit);
}

/** Owner reclaims free (unlocked) funds — exempt from pause, limits, and the whitelist. */
export async function adminWithdraw(
  t: Treasury,
  to: string,
  amountXlm: number,
): Promise<PayResult> {
  return sendTx(
    () => t.client.admin_withdraw({ to, amount: toStroops(amountXlm) }),
    "Withdraw failed.",
    t.submit,
  );
}

/** Update the spending limits, effective immediately (owner-signed). */
export async function setLimits(
  t: Treasury,
  dailyXlm: number,
  perTaskXlm: number,
): Promise<PayResult> {
  return sendTx(
    () =>
      t.client.set_limits({
        daily_limit: toStroops(dailyXlm),
        per_task_limit: toStroops(perTaskXlm),
      }),
    "Limit update failed.",
    t.submit,
  );
}

/** Register a session agent (owner-signed). While active it is the treasury's
 *  ONLY spender — time-bound, spend-capped, instantly revocable. */
export async function setSession(
  t: Treasury,
  agent: string,
  validUntil: bigint,
  capXlm: number,
): Promise<PayResult> {
  return sendTx(
    () => t.client.set_session({ agent, valid_until: validUntil, limit: toStroops(capXlm) }),
    "Session start failed.",
    t.submit,
  );
}

/** A Leash for one task (owner-signed, v4): like a session, but the agent may pay only the
 *  named payees. What the owner signs when approving an agent's budget request. */
export async function setTaskBudget(
  t: Treasury,
  agent: string,
  validUntil: bigint,
  limitStroops: bigint,
  payees: string[],
): Promise<PayResult> {
  return sendTx(
    () => t.client.set_task_budget({ agent, valid_until: validUntil, limit: limitStroops, payees }),
    "Budget approval failed.",
    t.submit,
  );
}

/** The most the agent may move per UTC calendar month (owner-signed, v4). 0 removes it. */
export async function setMonthlyLimit(t: Treasury, limitXlm: number): Promise<PayResult> {
  return sendTx(() => t.client.set_monthly_limit({ limit: toStroops(limitXlm) }), "Monthly limit update failed.", t.submit);
}

/** The most one payee may receive per month (owner-signed, v4). 0 removes the cap. */
export async function setPayeeCap(t: Treasury, payee: string, capXlm: number): Promise<PayResult> {
  return sendTx(() => t.client.set_payee_cap({ payee, cap: toStroops(capXlm) }), "Payee cap update failed.", t.submit);
}

/** Instantly revoke the session (owner-signed) — spending falls back to the wallet. */
export async function revokeSession(t: Treasury): Promise<PayResult> {
  return sendTx(() => t.client.revoke_session(), "Session revoke failed.", t.submit);
}
