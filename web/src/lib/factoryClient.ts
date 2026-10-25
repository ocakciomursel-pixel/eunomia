import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





/**
 * A time-bound, spend-capped agent credential to start the treasury with (the Leash).
 */
export interface Leash {
  agent: string;
  limit: i128;
  valid_until: u64;
}


/**
 * Everything a treasury needs to be useful on the first ledger it exists in.
 */
export interface Setup {
  daily_limit: i128;
  /**
 * Amount of `token` deposited from the owner into the treasury (0 = unfunded). Refused
 * as a whole if negative or if it exceeds the token's deposit cap.
 */
fund: i128;
  /**
 * Start a Leash for an agent key right away: empty = none, one entry = that agent.
 * (A `Vec` rather than an `Option`: the SDK's spec cannot carry an optional struct.)
 */
leash: Array<Leash>;
  /**
 * Most the agent may move per UTC calendar month (0 = no monthly limit).
 */
monthly_limit: i128;
  /**
 * Owner of the funds: becomes the treasury's admin AND root agent (as the app did).
 */
owner: string;
  /**
 * Monthly caps on individual payees (may be empty). A cap does not approve its payee.
 */
payee_caps: Array<PayeeCap>;
  /**
 * Payees approved from the start (may be empty).
 */
payees: Array<string>;
  per_task_limit: i128;
  /**
 * Record the treasury under the owner in the registry (cross-device recovery).
 */
register: boolean;
  /**
 * Caller-chosen; the treasury address is derived from the factory and this salt.
 */
salt: Buffer;
  /**
 * SEP-41 / SAC token the treasury holds and spends.
 */
token: string;
}


/**
 * A monthly ceiling on what one payee may receive (v4).
 */
export interface PayeeCap {
  cap: i128;
  payee: string;
}


/**
 * A token the factory accepts and the deposit cap its treasuries are born with
 * (0 = uncapped), in the token's own units.
 */
export interface TokenCap {
  cap: i128;
  token: string;
}

export const FactoryError = {
  1: {message:"NoTokens"},
  2: {message:"NegativeDepositCap"},
  3: {message:"DuplicateToken"},
  4: {message:"TooManyLeashes"},
  5: {message:"TokenNotAccepted"},
  6: {message:"NegativeFund"}
}

export interface Client {
  /**
   * Construct and simulate a create transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Deploy a treasury and set it up — one owner signature for the whole thing.
   * 
   * Order matters for atomicity only in the sense that any refusal (an incoherent
   * policy in the constructor, an invalid Leash, an unfunded owner) aborts the entire
   * transaction: no half-configured treasury can exist.
   */
  create: ({s}: {s: Setup}, options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a tokens transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The tokens a treasury from this factory may hold.
   */
  tokens: (options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a registry transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  registry: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a deposit_cap transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * The deposit cap a treasury of `token` is born with (0 = uncapped), or `None` for a
   * token this factory does not accept.
   */
  deposit_cap: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<i128>>>

  /**
   * Construct and simulate a treasury_wasm transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  treasury_wasm: (options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {treasury_wasm, registry, caps}: {treasury_wasm: Buffer, registry: string, caps: Array<TokenCap>},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({treasury_wasm, registry, caps}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAFNBIHRpbWUtYm91bmQsIHNwZW5kLWNhcHBlZCBhZ2VudCBjcmVkZW50aWFsIHRvIHN0YXJ0IHRoZSB0cmVhc3VyeSB3aXRoICh0aGUgTGVhc2gpLgAAAAAAAAAABUxlYXNoAAAAAAAAAwAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAVsaW1pdAAAAAAAAAsAAAAAAAAAC3ZhbGlkX3VudGlsAAAAAAY=",
        "AAAAAQAAAEpFdmVyeXRoaW5nIGEgdHJlYXN1cnkgbmVlZHMgdG8gYmUgdXNlZnVsIG9uIHRoZSBmaXJzdCBsZWRnZXIgaXQgZXhpc3RzIGluLgAAAAAAAAAAAAVTZXR1cAAAAAAAAAsAAAAAAAAAC2RhaWx5X2xpbWl0AAAAAAsAAACVQW1vdW50IG9mIGB0b2tlbmAgZGVwb3NpdGVkIGZyb20gdGhlIG93bmVyIGludG8gdGhlIHRyZWFzdXJ5ICgwID0gdW5mdW5kZWQpLiBSZWZ1c2VkCmFzIGEgd2hvbGUgaWYgbmVnYXRpdmUgb3IgaWYgaXQgZXhjZWVkcyB0aGUgdG9rZW4ncyBkZXBvc2l0IGNhcC4AAAAAAAAEZnVuZAAAAAsAAACjU3RhcnQgYSBMZWFzaCBmb3IgYW4gYWdlbnQga2V5IHJpZ2h0IGF3YXk6IGVtcHR5ID0gbm9uZSwgb25lIGVudHJ5ID0gdGhhdCBhZ2VudC4KKEEgYFZlY2AgcmF0aGVyIHRoYW4gYW4gYE9wdGlvbmA6IHRoZSBTREsncyBzcGVjIGNhbm5vdCBjYXJyeSBhbiBvcHRpb25hbCBzdHJ1Y3QuKQAAAAAFbGVhc2gAAAAAAAPqAAAH0AAAAAVMZWFzaAAAAAAAAEZNb3N0IHRoZSBhZ2VudCBtYXkgbW92ZSBwZXIgVVRDIGNhbGVuZGFyIG1vbnRoICgwID0gbm8gbW9udGhseSBsaW1pdCkuAAAAAAANbW9udGhseV9saW1pdAAAAAAAAAsAAABRT3duZXIgb2YgdGhlIGZ1bmRzOiBiZWNvbWVzIHRoZSB0cmVhc3VyeSdzIGFkbWluIEFORCByb290IGFnZW50IChhcyB0aGUgYXBwIGRpZCkuAAAAAAAABW93bmVyAAAAAAAAEwAAAFNNb250aGx5IGNhcHMgb24gaW5kaXZpZHVhbCBwYXllZXMgKG1heSBiZSBlbXB0eSkuIEEgY2FwIGRvZXMgbm90IGFwcHJvdmUgaXRzIHBheWVlLgAAAAAKcGF5ZWVfY2FwcwAAAAAD6gAAB9AAAAAIUGF5ZWVDYXAAAAAuUGF5ZWVzIGFwcHJvdmVkIGZyb20gdGhlIHN0YXJ0IChtYXkgYmUgZW1wdHkpLgAAAAAABnBheWVlcwAAAAAD6gAAABMAAAAAAAAADnBlcl90YXNrX2xpbWl0AAAAAAALAAAATFJlY29yZCB0aGUgdHJlYXN1cnkgdW5kZXIgdGhlIG93bmVyIGluIHRoZSByZWdpc3RyeSAoY3Jvc3MtZGV2aWNlIHJlY292ZXJ5KS4AAAAIcmVnaXN0ZXIAAAABAAAATkNhbGxlci1jaG9zZW47IHRoZSB0cmVhc3VyeSBhZGRyZXNzIGlzIGRlcml2ZWQgZnJvbSB0aGUgZmFjdG9yeSBhbmQgdGhpcyBzYWx0LgAAAAAABHNhbHQAAAPuAAAAIAAAADFTRVAtNDEgLyBTQUMgdG9rZW4gdGhlIHRyZWFzdXJ5IGhvbGRzIGFuZCBzcGVuZHMuAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAAAQAAADVBIG1vbnRobHkgY2VpbGluZyBvbiB3aGF0IG9uZSBwYXllZSBtYXkgcmVjZWl2ZSAodjQpLgAAAAAAAAAAAAAIUGF5ZWVDYXAAAAACAAAAAAAAAANjYXAAAAAACwAAAAAAAAAFcGF5ZWUAAAAAAAAT",
        "AAAAAQAAAHZBIHRva2VuIHRoZSBmYWN0b3J5IGFjY2VwdHMgYW5kIHRoZSBkZXBvc2l0IGNhcCBpdHMgdHJlYXN1cmllcyBhcmUgYm9ybiB3aXRoCigwID0gdW5jYXBwZWQpLCBpbiB0aGUgdG9rZW4ncyBvd24gdW5pdHMuAAAAAAAAAAAACFRva2VuQ2FwAAAAAgAAAAAAAAADY2FwAAAAAAsAAAAAAAAABXRva2VuAAAAAAAAEw==",
        "AAAABAAAAAAAAAAAAAAADEZhY3RvcnlFcnJvcgAAAAYAAAAAAAAACE5vVG9rZW5zAAAAAQAAAAAAAAASTmVnYXRpdmVEZXBvc2l0Q2FwAAAAAAACAAAAAAAAAA5EdXBsaWNhdGVUb2tlbgAAAAAAAwAAAAAAAAAOVG9vTWFueUxlYXNoZXMAAAAAAAQAAAAAAAAAEFRva2VuTm90QWNjZXB0ZWQAAAAFAAAAAAAAAAxOZWdhdGl2ZUZ1bmQAAAAG",
        "AAAAAAAAASFEZXBsb3kgYSB0cmVhc3VyeSBhbmQgc2V0IGl0IHVwIOKAlCBvbmUgb3duZXIgc2lnbmF0dXJlIGZvciB0aGUgd2hvbGUgdGhpbmcuCgpPcmRlciBtYXR0ZXJzIGZvciBhdG9taWNpdHkgb25seSBpbiB0aGUgc2Vuc2UgdGhhdCBhbnkgcmVmdXNhbCAoYW4gaW5jb2hlcmVudApwb2xpY3kgaW4gdGhlIGNvbnN0cnVjdG9yLCBhbiBpbnZhbGlkIExlYXNoLCBhbiB1bmZ1bmRlZCBvd25lcikgYWJvcnRzIHRoZSBlbnRpcmUKdHJhbnNhY3Rpb246IG5vIGhhbGYtY29uZmlndXJlZCB0cmVhc3VyeSBjYW4gZXhpc3QuAAAAAAAABmNyZWF0ZQAAAAAAAQAAAAAAAAABcwAAAAAAB9AAAAAFU2V0dXAAAAAAAAABAAAD6QAAABMAAAfQAAAADEZhY3RvcnlFcnJvcg==",
        "AAAAAAAAADFUaGUgdG9rZW5zIGEgdHJlYXN1cnkgZnJvbSB0aGlzIGZhY3RvcnkgbWF5IGhvbGQuAAAAAAAABnRva2VucwAAAAAAAAAAAAEAAAPqAAAAEw==",
        "AAAAAAAAAAAAAAAIcmVnaXN0cnkAAAAAAAAAAQAAABM=",
        "AAAAAAAAAHZUaGUgZGVwb3NpdCBjYXAgYSB0cmVhc3VyeSBvZiBgdG9rZW5gIGlzIGJvcm4gd2l0aCAoMCA9IHVuY2FwcGVkKSwgb3IgYE5vbmVgIGZvciBhCnRva2VuIHRoaXMgZmFjdG9yeSBkb2VzIG5vdCBhY2NlcHQuAAAAAAALZGVwb3NpdF9jYXAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+gAAAAL",
        "AAAAAAAAARdQaW5zIHRoZSB0cmVhc3VyeSBjb2RlLCB0aGUgcmVnaXN0cnkgYW5kIHRoZSBhY2NlcHRlZCB0b2tlbnMgd2l0aCB0aGVpciBkZXBvc2l0IGNhcHMuCkltbXV0YWJsZSBhZnRlciBkZXBsb3kgKG5vIHNldHRlcnMpOiBhIGZhY3RvcnkgdGhhdCBjb3VsZCBiZSByZS1wb2ludGVkIHdvdWxkIGJlIGEgd2F5CnRvIGhhbmQgdXNlcnMgZGlmZmVyZW50IGNvZGUsIGFuZCBvbmUgd2hvc2UgY2FwcyBjb3VsZCBiZSByYWlzZWQgd291bGQgbWFrZSB0aGUgYmV0YQpib3VuZCBhIHByb21pc2Ugb25seS4AAAAADV9fY29uc3RydWN0b3IAAAAAAAADAAAAAAAAAA10cmVhc3VyeV93YXNtAAAAAAAD7gAAACAAAAAAAAAACHJlZ2lzdHJ5AAAAEwAAAAAAAAAEY2FwcwAAA+oAAAfQAAAACFRva2VuQ2FwAAAAAA==",
        "AAAAAAAAAAAAAAANdHJlYXN1cnlfd2FzbQAAAAAAAAAAAAABAAAD7gAAACA=" ]),
      options
    )
  }
  public readonly fromJSON = {
    create: this.txFromJSON<Result<string>>,
        tokens: this.txFromJSON<Array<string>>,
        registry: this.txFromJSON<string>,
        deposit_cap: this.txFromJSON<Option<i128>>,
        treasury_wasm: this.txFromJSON<Buffer>
  }
}