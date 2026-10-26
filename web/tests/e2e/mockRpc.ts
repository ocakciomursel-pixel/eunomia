import { type Page } from "@playwright/test";
import {
  Address,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  xdr,
  type Operation,
} from "@stellar/stellar-sdk";
import { encodeExceptionPayload, exceptionEntryName } from "../../src/lib/exceptionCodec";
import { TREASURY_WASM_HASH } from "../../src/lib/treasuryWasm";

export const ADMIN = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
export const AGENT = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
export const PAYEE_A = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
export const PAYEE_B = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4)).publicKey();
export const TREASURY_A = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";
export const TREASURY_B = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
export const XLM_SAC = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";

function retvalFor(fn: string): xdr.ScVal {
  switch (fn) {
    case "balance":
      return nativeToScVal(2_500_000_000n, { type: "i128" });
    case "day_spent":
    case "month_spent":
      return nativeToScVal(125_000_000n, { type: "i128" });
    case "get_config":
      return nativeToScVal(
        {
          admin: Address.fromString(ADMIN),
          agent: Address.fromString(AGENT),
          daily_limit: 500_000_000n,
          per_task_limit: 100_000_000n,
          token: Address.fromString(XLM_SAC),
        },
        {
          type: {
            admin: ["symbol", "address"],
            agent: ["symbol", "address"],
            daily_limit: ["symbol", "i128"],
            per_task_limit: ["symbol", "i128"],
            token: ["symbol", "address"],
          },
        },
      );
    case "is_paused":
      return nativeToScVal(false);
    case "get_session":
      return nativeToScVal(
        {
          agent: Address.fromString(AGENT),
          limit: 500_000_000n,
          spent: 125_000_000n,
          valid_until: 4_102_444_800n,
        },
        {
          type: {
            agent: ["symbol", "address"],
            limit: ["symbol", "i128"],
            spent: ["symbol", "i128"],
            valid_until: ["symbol", "u64"],
          },
        },
      );
    case "this_month":
      return nativeToScVal(24322, { type: "u32" });
    case "monthly_limit":
      return nativeToScVal(0n, { type: "i128" });
    case "deposit_cap":
      return nativeToScVal(10_000_000_000n, { type: "i128" });
    case "session_payees":
      return nativeToScVal([], { type: "vec" });
    case "get_treasuries":
      return nativeToScVal([Address.fromString(TREASURY_A)]);
    case "is_payee":
      return nativeToScVal(true);
    default:
      return xdr.ScVal.scvVoid();
  }
}

function buildMockEvents() {
  return [
    {
      id: "0214748364800000000-0000000001",
      type: "contract",
      ledger: 49990,
      ledgerClosedAt: "2026-10-26T12:00:00.000Z",
      contractId: TREASURY_A,
      pagingToken: "0214748364800000000-0000000001",
      inSuccessfulContractCall: true,
      topic: [
        nativeToScVal("paid", { type: "symbol" }).toXDR("base64"),
        nativeToScVal(101n, { type: "u64" }).toXDR("base64"),
      ],
      value: nativeToScVal([
        Address.fromString(PAYEE_A),
        nativeToScVal(125_000_000n, { type: "i128" }),
      ]).toXDR("base64"),
      txHash: "a".repeat(64),
    },
    {
      id: "0214748364800000000-0000000002",
      type: "contract",
      ledger: 49991,
      ledgerClosedAt: "2026-10-26T12:01:00.000Z",
      contractId: TREASURY_A,
      pagingToken: "0214748364800000000-0000000002",
      inSuccessfulContractCall: true,
      topic: [nativeToScVal("payee_add", { type: "symbol" }).toXDR("base64")],
      value: nativeToScVal(Address.fromString(PAYEE_A)).toXDR("base64"),
      txHash: "b".repeat(64),
    },
    {
      id: "0214748364800000000-0000000003",
      type: "contract",
      ledger: 49992,
      ledgerClosedAt: "2026-10-26T12:02:00.000Z",
      contractId: TREASURY_B,
      pagingToken: "0214748364800000000-0000000003",
      inSuccessfulContractCall: true,
      topic: [nativeToScVal("paused", { type: "symbol" }).toXDR("base64")],
      value: nativeToScVal(true).toXDR("base64"),
      txHash: "c".repeat(64),
    },
  ];
}

export async function setupMockedTreasurySession(page: Page): Promise<void> {
  const exceptionBytes = encodeExceptionPayload({
    payee: PAYEE_B,
    amount: 250_000_000n,
    taskId: 102n,
    reasonCodes: [2],
    requestedAt: 1_761_480_120,
  });
  const exceptionKey = exceptionEntryName(TREASURY_A, 1_761_480_120_000);
  const exceptionBase64 = Buffer.from(exceptionBytes).toString("base64");

  await page.context().addInitScript(
    ({ admin, treasuryA, payeeA }) => {
      sessionStorage.setItem("prism_wallet_address", admin);
      localStorage.setItem("prism_wallet_address", admin);
      localStorage.setItem(
        `prism_treasuries:${admin}`,
        JSON.stringify({ ids: [treasuryA], active: treasuryA }),
      );
      localStorage.setItem(`prism_payees:${treasuryA}`, JSON.stringify([payeeA]));
      localStorage.setItem(
        `prism_ledger:${treasuryA}`,
        JSON.stringify([
          {
            id: "0214748364800000000-0000000001",
            kind: "paid",
            label: `Agent paid 12.5 XLM to ${payeeA.slice(0, 4)}…${payeeA.slice(-4)} · task 101`,
            txHash: "a".repeat(64),
            at: "2026-10-26T12:00:00.000Z",
            amountXlm: 12.5,
            treasuryId: treasuryA,
          },
        ]),
      );
    },
    { admin: ADMIN, treasuryA: TREASURY_A, payeeA: PAYEE_A },
  );

  await page.route("https://horizon.stellar.org/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: AGENT,
        account_id: AGENT,
        sequence: "1",
        balances: [{ asset_type: "native", balance: "120.0000000" }],
        data: {
          [exceptionKey]: exceptionBase64,
        },
      }),
    });
  });

  await page.route("**/api/rpc", async (route) => {
    const req = route.request().postDataJSON() as {
      id: number | string;
      method: string;
      params?: Record<string, unknown>;
    };

    if (req.method === "getLedgerEntries") {
      const keyB64 = (req.params?.keys as string[])[0];
      const key = xdr.LedgerKey.fromXDR(keyB64, "base64");
      let entryData: xdr.LedgerEntryData;
      if (key.switch() === xdr.LedgerEntryType.account()) {
        entryData = xdr.LedgerEntryData.account(
          new xdr.AccountEntry({
            accountId: key.account().accountId(),
            balance: xdr.Int64.fromString("1000000000"),
            seqNum: xdr.SequenceNumber.fromString("1"),
            numSubEntries: 0,
            inflationDest: undefined,
            flags: 0,
            homeDomain: Buffer.alloc(0),
            thresholds: Buffer.from([1, 0, 0, 0]),
            signers: [],
            ext: new xdr.AccountEntryExt(0),
          }),
        );
      } else {
        entryData = xdr.LedgerEntryData.contractData(
          new xdr.ContractDataEntry({
            ext: new xdr.ExtensionPoint(0),
            contract: key.contractData().contract(),
            key: xdr.ScVal.scvLedgerKeyContractInstance(),
            durability: xdr.ContractDataDurability.persistent(),
            val: xdr.ScVal.scvContractInstance(
              new xdr.ScContractInstance({
                executable: xdr.ContractExecutable.contractExecutableWasm(
                  Buffer.from(TREASURY_WASM_HASH, "hex"),
                ),
                storage: [],
              }),
            ),
          }),
        );
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            latestLedger: 50000,
            entries: [
              {
                key: keyB64,
                xdr: entryData.toXDR("base64"),
                lastModifiedLedgerSeq: 49999,
                liveUntilLedgerSeq: 999999,
              },
            ],
          },
        }),
      });
      return;
    }

    if (req.method === "simulateTransaction") {
      const txXdr = req.params?.transaction as string;
      const tx = TransactionBuilder.fromXDR(txXdr, Networks.PUBLIC);
      const op = tx.operations[0] as Operation.InvokeHostFunction;
      const fn = op.func.invokeContract().functionName().toString();
      const retval = retvalFor(fn);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            latestLedger: 50000,
            minResourceFee: "100",
            cost: { cpuInsns: "100", memBytes: "100" },
            results: [{ xdr: retval.toXDR("base64"), auth: [] }],
          },
        }),
      });
      return;
    }

    if (req.method === "getLatestLedger") {
      const header = new xdr.LedgerHeader({
        ledgerVersion: 22,
        previousLedgerHash: Buffer.alloc(32),
        scpValue: new xdr.StellarValue({
          txSetHash: Buffer.alloc(32),
          closeTime: xdr.Uint64.fromString("1761480000"),
          upgrades: [],
          ext: xdr.StellarValueExt.stellarValueBasic(),
        }),
        txSetResultHash: Buffer.alloc(32),
        bucketListHash: Buffer.alloc(32),
        ledgerSeq: 50000,
        totalCoins: xdr.Int64.fromString("1000000000"),
        feePool: xdr.Int64.fromString("0"),
        inflationSeq: 0,
        idPool: xdr.Uint64.fromString("0"),
        baseFee: 100,
        baseReserve: 5000000,
        maxTxSetSize: 100,
        skipList: [Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32)],
        ext: new xdr.LedgerHeaderExt(0),
      });
      const meta = new xdr.LedgerCloseMeta(
        0,
        new xdr.LedgerCloseMetaV0({
          ledgerHeader: new xdr.LedgerHeaderHistoryEntry({
            hash: Buffer.alloc(32),
            header,
            ext: new xdr.LedgerHeaderHistoryEntryExt(0),
          }),
          txSet: new xdr.TransactionSet({ previousLedgerHash: Buffer.alloc(32), txes: [] }),
          txProcessing: [],
          upgradesProcessing: [],
          scpInfo: [],
        }),
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            id: "l1",
            protocolVersion: 22,
            sequence: 50000,
            closeTime: "1761480000",
            headerXdr: header.toXDR("base64"),
            metadataXdr: meta.toXDR("base64"),
          },
        }),
      });
      return;
    }

    if (req.method === "getEvents") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            latestLedger: 50000,
            events: buildMockEvents(),
            cursor: "",
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        result: { latestLedger: 50000, events: [] },
      }),
    });
  });
}
