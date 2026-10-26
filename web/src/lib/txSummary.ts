// Human-readable transaction summary decoded directly from the root `xdr.HostFunction`
// before the passkey or wallet prompt opens.
//
// `authCheck.ts` proves the simulation's auth entries match the transaction's own root
// host function byte for byte; this module turns that verified `xdr.HostFunction` into a
// readable sentence with full, unshortened Stellar addresses so the user can see what
// they are about to authorise before touching their passkey or confirming in their wallet.
import { Address, scValToNative, TransactionBuilder, xdr, type Transaction } from "@stellar/stellar-sdk";
import { fmtXlm, NETWORK_PASSPHRASE, USDC_TOKEN, XLM_SAC } from "../config";
import { tokenCodeOf, type TokenCode } from "./token";

export interface SummaryOptions {
  /** Token unit for treasury amounts (defaults to active treasury token or XLM). */
  token?: TokenCode;
}

let activeTokenCode: TokenCode = "XLM";

/** Keep the default token unit in sync with the open treasury in the UI. */
export function setActiveTokenCode(code: TokenCode): void {
  activeTokenCode = code;
}

export function getActiveTokenCode(): TokenCode {
  return activeTokenCode;
}

function decodeAddress(val: xdr.ScVal | undefined): string {
  if (!val) return "unknown";
  try {
    return Address.fromScVal(val).toString();
  } catch {
    try {
      return String(scValToNative(val));
    } catch {
      return "unknown";
    }
  }
}

function decodeBigInt(val: xdr.ScVal | undefined): bigint {
  if (!val) return 0n;
  try {
    const native = scValToNative(val);
    if (typeof native === "bigint") return native;
    if (typeof native === "number" || typeof native === "string") return BigInt(native);
  } catch {
    /* fall through */
  }
  return 0n;
}

function decodeAddressVec(val: xdr.ScVal | undefined): string[] {
  if (!val) return [];
  try {
    if (val.switch().name === "scvVec") {
      return (val.vec() ?? []).map((item) => decodeAddress(item));
    }
    const native = scValToNative(val);
    if (Array.isArray(native)) return native.map((v) => String(v));
  } catch {
    /* ignore */
  }
  return [];
}

function formatAmount(stroops: bigint, token: TokenCode): string {
  return `${fmtXlm(stroops)} ${token}`;
}

function formatGenericValue(val: unknown): string {
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
    return Buffer.from(val).toString("hex");
  }
  if (Array.isArray(val)) {
    return `[${val.map(formatGenericValue).join(", ")}]`;
  }
  if (val && typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>).map(
      ([k, v]) => `${k}=${formatGenericValue(v)}`,
    );
    return `{${entries.join(", ")}}`;
  }
  return String(val);
}

function formatScVal(val: xdr.ScVal): string {
  try {
    if (val.switch().name === "scvAddress") {
      return Address.fromScVal(val).toString();
    }
    return formatGenericValue(scValToNative(val));
  } catch {
    return val.switch().name;
  }
}

/** Decode a root `xdr.HostFunction` into a human-readable summary sentence.
 *  Every address (`G…` or `C…`) is rendered in full and never shortened. */
export function describeHostFunction(fn: xdr.HostFunction, opts?: SummaryOptions): string {
  const kind = fn.switch().name;

  if (kind === "hostFunctionTypeCreateContractV2" || kind === "hostFunctionTypeCreateContract") {
    const createArgs =
      kind === "hostFunctionTypeCreateContractV2" ? fn.createContractV2() : fn.createContract();
    const preimage = createArgs.contractIdPreimage();
    const deployer =
      preimage.switch().name === "contractIdPreimageFromAddress"
        ? Address.fromScAddress(preimage.fromAddress().address()).toString()
        : "source_account";
    const exec = createArgs.executable();
    const wasm =
      exec.switch().name === "contractExecutableWasm"
        ? exec.wasmHash().toString("hex")
        : exec.switch().name;
    const ctorArgs =
      kind === "hostFunctionTypeCreateContractV2"
        ? fn.createContractV2().constructorArgs().map(formatScVal)
        : [];
    const ctorSuffix = ctorArgs.length > 0 ? `, args=[${ctorArgs.join(", ")}]` : "";
    return `deploy_contract(deployer=${deployer}, wasm=${wasm}${ctorSuffix})`;
  }

  if (kind !== "hostFunctionTypeInvokeContract") {
    return `host_function(${kind})`;
  }

  const invoke = fn.invokeContract();
  const contractId = Address.fromScAddress(invoke.contractAddress()).toString();
  const fnName = invoke.functionName().toString();
  const args = invoke.args();

  const token: TokenCode =
    opts?.token ??
    (contractId === USDC_TOKEN
      ? "USDC"
      : contractId === XLM_SAC
        ? "XLM"
        : activeTokenCode);

  switch (fnName) {
    case "admin_withdraw":
    case "withdraw": {
      const to = decodeAddress(args[0]);
      const amount = formatAmount(decodeBigInt(args[1]), token);
      return `${fnName}(to=${to}, ${amount}) on treasury ${contractId}`;
    }

    case "set_limits": {
      const daily = formatAmount(decodeBigInt(args[0]), token);
      const perTask = formatAmount(decodeBigInt(args[1]), token);
      return `set_limits(daily_limit=${daily}, per_task_limit=${perTask}) on treasury ${contractId}`;
    }

    case "add_payee": {
      const payee = decodeAddress(args[0]);
      return `add_payee(payee=${payee}) on treasury ${contractId}`;
    }

    case "remove_payee": {
      const payee = decodeAddress(args[0]);
      return `remove_payee(payee=${payee}) on treasury ${contractId}`;
    }

    case "set_agent": {
      const agent = decodeAddress(args[0]);
      return `set_agent(agent=${agent}) on treasury ${contractId}`;
    }

    case "set_session": {
      const agent = decodeAddress(args[0]);
      const validUntil = decodeBigInt(args[1]);
      const limit = formatAmount(decodeBigInt(args[2]), token);
      return `set_session(agent=${agent}, limit=${limit}, valid_until=${validUntil.toString()}) on treasury ${contractId}`;
    }

    case "set_task_budget": {
      const agent = decodeAddress(args[0]);
      const validUntil = decodeBigInt(args[1]);
      const limit = formatAmount(decodeBigInt(args[2]), token);
      const payees = decodeAddressVec(args[3]);
      return `set_task_budget(agent=${agent}, limit=${limit}, valid_until=${validUntil.toString()}, payees=[${payees.join(", ")}]) on treasury ${contractId}`;
    }

    case "set_payee_cap": {
      const payee = decodeAddress(args[0]);
      const cap = formatAmount(decodeBigInt(args[1]), token);
      return `set_payee_cap(payee=${payee}, cap=${cap}) on treasury ${contractId}`;
    }

    case "set_monthly_limit": {
      const limit = formatAmount(decodeBigInt(args[0]), token);
      return `set_monthly_limit(limit=${limit}) on treasury ${contractId}`;
    }

    case "set_paused": {
      const paused = args[0] ? Boolean(scValToNative(args[0])) : false;
      return `set_paused(paused=${paused}) on treasury ${contractId}`;
    }

    case "revoke_session": {
      return `revoke_session() on treasury ${contractId}`;
    }

    case "pay": {
      const taskId = decodeBigInt(args[0]);
      const to = decodeAddress(args[1]);
      const amount = formatAmount(decodeBigInt(args[2]), token);
      return `pay(to=${to}, ${amount}, task_id=${taskId.toString()}) on treasury ${contractId}`;
    }

    case "deposit": {
      const from = decodeAddress(args[0]);
      const amount = formatAmount(decodeBigInt(args[1]), token);
      return `deposit(from=${from}, ${amount}) on treasury ${contractId}`;
    }

    case "create_escrow": {
      const taskId = decodeBigInt(args[0]);
      const payee = decodeAddress(args[1]);
      const amount = formatAmount(decodeBigInt(args[2]), token);
      const deadline = decodeBigInt(args[3]);
      return `create_escrow(payee=${payee}, ${amount}, task_id=${taskId.toString()}, deadline=${deadline.toString()}) on treasury ${contractId}`;
    }

    case "release_escrow":
    case "refund_escrow":
    case "admin_cancel_escrow": {
      const id = decodeBigInt(args[0]);
      return `${fnName}(id=${id.toString()}) on treasury ${contractId}`;
    }

    case "transfer": {
      const from = decodeAddress(args[0]);
      const to = decodeAddress(args[1]);
      const amount = formatAmount(decodeBigInt(args[2]), token);
      return `transfer(from=${from}, to=${to}, ${amount}) on token ${contractId}`;
    }

    case "register":
    case "unregister": {
      const owner = decodeAddress(args[0]);
      const treasury = decodeAddress(args[1]);
      return `${fnName}(owner=${owner}, treasury=${treasury}) on registry ${contractId}`;
    }

    case "create": {
      if (args[0] && args[0].switch().name === "scvMap") {
        try {
          const setup = scValToNative(args[0]) as Record<string, unknown>;
          const setupToken = tokenCodeOf(typeof setup.token === "string" ? setup.token : undefined);
          const owner = String(setup.owner ?? "");
          const daily = formatAmount(BigInt((setup.daily_limit as bigint | number | undefined) ?? 0n), setupToken);
          const perTask = formatAmount(BigInt((setup.per_task_limit as bigint | number | undefined) ?? 0n), setupToken);
          const parts = [`owner=${owner}`, `daily_limit=${daily}`, `per_task_limit=${perTask}`];
          const fund = BigInt((setup.fund as bigint | number | undefined) ?? 0n);
          if (fund > 0n) parts.push(`fund=${formatAmount(fund, setupToken)}`);
          const payees = Array.isArray(setup.payees) ? setup.payees.map(String) : [];
          if (payees.length > 0) parts.push(`payees=[${payees.join(", ")}]`);
          const leash = Array.isArray(setup.leash) && setup.leash[0] ? (setup.leash[0] as Record<string, unknown>) : null;
          if (leash) {
            const leashLimit = formatAmount(BigInt((leash.limit as bigint | number | undefined) ?? 0n), setupToken);
            parts.push(`agent=${String(leash.agent ?? "")}`, `leash_limit=${leashLimit}`);
          }
          return `create(${parts.join(", ")}) on factory ${contractId}`;
        } catch {
          /* fall through to generic formatting */
        }
      }
      return `create(${args.map(formatScVal).join(", ")}) on contract ${contractId}`;
    }

    default: {
      return `${fnName}(${args.map(formatScVal).join(", ")}) on contract ${contractId}`;
    }
  }
}

export const summarizeHostFunction = describeHostFunction;

/** Extract the root `xdr.HostFunction` from an assembled contract transaction or envelope XDR. */
export function hostFunctionFromTx(tx: { built?: unknown } | string): xdr.HostFunction | null {
  try {
    if (typeof tx === "string") {
      const parsed = TransactionBuilder.fromXDR(tx, NETWORK_PASSPHRASE);
      const ops = "operations" in parsed ? parsed.operations : [];
      const op = ops.find((o) => o.type === "invokeHostFunction") as
        | { type: "invokeHostFunction"; func: xdr.HostFunction }
        | undefined;
      return op?.func ?? null;
    }
    const op = (tx.built as Transaction | undefined)?.operations?.[0];
    if (op && op.type === "invokeHostFunction") {
      return op.func;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export interface PendingTxConfirmation {
  summary: string;
  confirm: () => void;
  cancel: () => void;
}

type ConfirmListener = (pending: PendingTxConfirmation | null) => void;
const confirmListeners = new Set<ConfirmListener>();

/** Subscribe a UI sheet (or test harness) to pending transaction confirmations. */
export function subscribeTxConfirmation(listener: ConfirmListener): () => void {
  confirmListeners.add(listener);
  return () => {
    confirmListeners.delete(listener);
  };
}

/** Show the readable transaction summary in the confirmation BottomSheet and wait for the
 *  user to confirm before invoking the passkey or wallet prompt.
 *
 *  When no UI confirmation sheet is mounted (e.g. headless unit tests of lower-level
 *  transport functions), resolves immediately after computing the summary. */
export function requestTxConfirmation(summary: string): Promise<void> {
  if (confirmListeners.size === 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const notify = (val: PendingTxConfirmation | null) => {
      for (const fn of confirmListeners) fn(val);
    };
    notify({
      summary,
      confirm: () => {
        notify(null);
        resolve();
      },
      cancel: () => {
        notify(null);
        reject(new Error("User rejected the transaction."));
      },
    });
  });
}

/** Decode `fn` into a readable sentence and require user confirmation before signing. */
export async function confirmHostFunction(
  fn: xdr.HostFunction,
  opts?: SummaryOptions,
): Promise<string> {
  const summary = describeHostFunction(fn, opts);
  await requestTxConfirmation(summary);
  return summary;
}

/** If `tx` carries an assembled host function, decode it and require user confirmation. */
export async function confirmAssembledTx(
  tx: { built?: unknown },
  opts?: SummaryOptions,
): Promise<string | null> {
  const fn = hostFunctionFromTx(tx);
  if (!fn) return null;
  return confirmHostFunction(fn, opts);
}
