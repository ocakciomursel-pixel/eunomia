// The task float: money the treasury hands the agent's own account so it can pay where the
// treasury itself cannot be the payer. Stellar's x402 and MPP facilitators settle from a
// G… account only today (stellar/stellar-mpp-sdk#90, x402-foundation/x402#3158) — a contract
// treasury is refused before its policy is ever consulted.
//
// A float leaves the contract's protection the moment it moves, so it is bounded three ways:
// the top-up is an ordinary treasury pay() (every on-chain limit applies), the owner can put
// a monthly payee cap on the agent's own address, and sweep_float returns what a task did
// not spend. call.ts adds the per-call checks before anything is signed.
import { Account, Address, Asset, BASE_FEE, Contract, Operation, TransactionBuilder, nativeToScVal, rpc, scValToNative } from "@stellar/stellar-sdk";
import { NULL_ACCOUNT } from "@stellar/stellar-sdk/contract";
import type { NetworkConfig } from "./network.js";
import { payFromTreasury, requireTreasury, type PayDeps, type PayOutcome } from "./pay.js";
import type { ServerContext } from "./server.js";
import { lacksTrustline, readTokenAsset } from "./receiver.js";
import { agentKeypair, pollTransaction, submitClassic } from "./signer.js";
import { makeClient } from "./treasury.js";

/** A holder's balance of a token contract (SEP-41 `balance`), by simulation — no key, no fee. */
export async function tokenBalance(
  net: NetworkConfig,
  tokenId: string,
  holder: string,
  server = new rpc.Server(net.rpcUrl),
): Promise<bigint> {
  const tx = new TransactionBuilder(new Account(NULL_ACCOUNT, "0"), { fee: BASE_FEE, networkPassphrase: net.passphrase })
    .addOperation(new Contract(tokenId).call("balance", new Address(holder).toScVal()))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  // A G… account with no trustline answers with an error rather than 0: it holds none.
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result?.retval) return 0n;
  return BigInt(scValToNative(sim.result.retval) as bigint);
}

export async function treasuryToken(ctx: ServerContext): Promise<string> {
  const id = requireTreasury(ctx);
  const client = (ctx.deps?.makeClient ?? makeClient)(ctx.net, id);
  return (await client.get_config()).result.token;
}

/** Top the float up from the treasury: an ordinary pay() to the agent's own address, so the
 *  treasury's limits, the agent's payee cap and the task budget all apply on-chain. */
export async function fundFloat(
  ctx: ServerContext,
  amount: bigint,
  taskId: bigint,
  deps: PayDeps = {},
): Promise<PayOutcome> {
  if (!ctx.credential) throw new Error("No agent credential — run `eunomia-mcp init` first.");
  return payFromTreasury(ctx, { to: ctx.credential.agentPublicKey, amount, taskId }, deps);
}

export interface SweepResult {
  swept: bigint;
  txHash: string | null;
  ledger: number;
  status: "SUCCESS" | "FAILED" | "NOTHING";
}

export interface SweepDeps {
  server?: rpc.Server;
  poll?: typeof pollTransaction;
  token?: string;
  asset?: Asset | null;
}

/** Return float to the treasury: a token transfer from the agent's account, signed by the
 *  agent. `amount` defaults to everything the account holds of the treasury's token. */
export async function sweepFloat(
  ctx: ServerContext,
  amount?: bigint,
  deps: SweepDeps = {},
): Promise<SweepResult> {
  const treasury = requireTreasury(ctx);
  if (!ctx.credential) throw new Error("No agent credential — run `eunomia-mcp init` first.");
  const server = deps.server ?? new rpc.Server(ctx.net.rpcUrl);
  const kp = agentKeypair(ctx.credential);
  const token = deps.token ?? (await treasuryToken(ctx));
  const held = await tokenBalance(ctx.net, token, kp.publicKey(), server);
  // On an XLM treasury the float sits in the same balance as the account's own XLM (its
  // reserve and fee money), so "everything" would empty the account. Name the amount there.
  const asset = deps.asset !== undefined ? deps.asset : await readTokenAsset(ctx.net, token, server);
  if (amount === undefined && asset?.isNative()) {
    throw new Error("this treasury holds XLM, which the agent's account also lives on — give the amount to return");
  }
  const swept = amount ?? held;
  if (swept <= 0n) return { swept: 0n, txHash: null, ledger: 0, status: "NOTHING" };
  if (swept > held) throw new Error(`the float holds ${held} stroops, less than the ${swept} asked to sweep`);

  const account = await server.getAccount(kp.publicKey());
  const built = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: ctx.net.passphrase })
    .addOperation(
      new Contract(token).call(
        "transfer",
        new Address(kp.publicKey()).toScVal(),
        new Address(treasury).toScVal(),
        nativeToScVal(swept, { type: "i128" }),
      ),
    )
    .setTimeout(60)
    .build();
  // The agent is both source and `from`: source-account auth covers the transfer.
  const tx = await server.prepareTransaction(built);
  tx.sign(kp);
  const sent = await server.sendTransaction(tx);
  if (sent.status !== "PENDING") {
    const detail = sent.errorResult ? sent.errorResult.result().switch().name : sent.status;
    throw new Error(`the network refused the sweep at submission: ${detail}`);
  }
  const final = await (deps.poll ?? pollTransaction)(server, sent.hash);
  return {
    swept,
    txHash: sent.hash,
    ledger: (final as { ledger?: number }).ledger ?? 0,
    status: final.status === rpc.Api.GetTransactionStatus.SUCCESS ? "SUCCESS" : "FAILED",
  };
}

export interface TrustlineDeps {
  server?: rpc.Server;
  token?: string;
  asset?: Asset | null;
  lacks?: typeof lacksTrustline;
  submit?: typeof submitClassic;
}

/** Let the agent's account hold the treasury's token: a classic trustline, needed once on
 *  mainnet before a USDC float can be funded (a G… account holds an issued asset only once
 *  it trusts the issuer). Signed by the agent; the account must already hold XLM for the
 *  reserve. Nothing to do for the native asset. */
export async function addTrustline(
  ctx: ServerContext,
  deps: TrustlineDeps = {},
): Promise<{ asset: string; txHash: string | null; status: "SUCCESS" | "FAILED" | "NOT_NEEDED" }> {
  if (!ctx.credential) throw new Error("No agent credential — run `eunomia-mcp init` first.");
  const server = deps.server ?? new rpc.Server(ctx.net.rpcUrl);
  const token = deps.token ?? (await treasuryToken(ctx));
  const asset = deps.asset !== undefined ? deps.asset : await readTokenAsset(ctx.net, token, server);
  if (!asset || asset.isNative()) return { asset: asset ? "XLM" : token, txHash: null, status: "NOT_NEEDED" };
  const kp = agentKeypair(ctx.credential);
  const checkLacks = deps.lacks ?? lacksTrustline;
  if (!(await checkLacks(ctx.net, token, kp.publicKey(), server))) {
    return { asset: `${asset.getCode()}:${asset.getIssuer()}`, txHash: null, status: "NOT_NEEDED" };
  }
  const submit = deps.submit ?? submitClassic;
  const r = await submit(ctx.net, kp, [Operation.changeTrust({ asset })], { server });
  return { asset: `${asset.getCode()}:${asset.getIssuer()}`, txHash: r.txHash, status: r.status };
}
