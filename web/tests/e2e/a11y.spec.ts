import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { Address, Keypair, nativeToScVal, Networks, TransactionBuilder, xdr, type Operation } from "@stellar/stellar-sdk";
import { TREASURY_WASM_HASH } from "../../src/lib/treasuryWasm";

const OWNER = Keypair.random().publicKey();
const TREASURY_1 = "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K";
const TREASURY_2 = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
const XLM_SAC = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";

function retvalFor(fn: string): xdr.ScVal {
  switch (fn) {
    case "balance":
      return nativeToScVal(500_000_000n, { type: "i128" });
    case "day_spent":
      return nativeToScVal(100_000_000n, { type: "i128" });
    case "get_config":
      return nativeToScVal(
        {
          admin: Address.fromString(OWNER),
          agent: Address.fromString(OWNER),
          daily_limit: 200_000_000n,
          per_task_limit: 50_000_000n,
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
      return xdr.ScVal.scvVoid();
    case "this_month":
      return nativeToScVal(24322, { type: "u32" });
    case "monthly_limit":
      return nativeToScVal(1_000_000_000n, { type: "i128" });
    case "month_spent":
      return nativeToScVal(100_000_000n, { type: "i128" });
    case "deposit_cap":
      return nativeToScVal(2_500_000_000n, { type: "i128" });
    case "session_payees":
      return nativeToScVal([], { type: "vec" });
    case "get_treasuries":
      return nativeToScVal([Address.fromString(TREASURY_1)]);
    case "is_payee":
      return nativeToScVal(true);
    default:
      return xdr.ScVal.scvVoid();
  }
}

async function seedMockedTreasury(page: Page) {
  await page.context().addInitScript(
    ({ owner, t1, t2 }) => {
      sessionStorage.setItem("prism_wallet_address", owner);
      localStorage.setItem(
        `prism_treasuries:${owner}`,
        JSON.stringify({ ids: [t1, t2], active: t1 }),
      );
    },
    { owner: OWNER, t1: TREASURY_1, t2: TREASURY_2 },
  );

  await page.route("https://horizon.stellar.org/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ balances: [{ asset_type: "native", balance: "120.0000000" }] }),
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
            latestLedger: 1000,
            entries: [
              {
                key: keyB64,
                xdr: entryData.toXDR("base64"),
                lastModifiedLedgerSeq: 999,
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
            latestLedger: 1000,
            minResourceFee: "100",
            cost: { cpuInsns: "100", memBytes: "100" },
            results: [{ xdr: retval.toXDR("base64"), auth: [] }],
          },
        }),
      });
      return;
    }

    if (req.method === "getLatestLedger") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { id: "l1", protocolVersion: 22, sequence: 1000 },
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
        result: { latestLedger: 1000, events: [] },
      }),
    });
  });
}

test("TreasurySwitcher is operable by keyboard alone and has no axe violations", async ({ page }) => {
  await seedMockedTreasury(page);
  await page.goto("/#overview");

  const chip = page.locator(".tswitch__chip");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  await expect(chip).toHaveAttribute("aria-haspopup", "true");

  // Open via keyboard
  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".tswitch__menu")).toBeVisible();

  // Run axe on TreasurySwitcher while open
  const axeSwitcher = await new AxeBuilder({ page }).include(".tswitch").analyze();
  expect(axeSwitcher.violations).toEqual([]);

  // Close on Escape and return focus to chip
  await page.keyboard.press("Escape");
  await expect(page.locator(".tswitch__menu")).toBeHidden();
  await expect(chip).toBeFocused();

  // Reopen, focus the second treasury's forget button, and activate with Space
  await page.keyboard.press(" ");
  await expect(page.locator(".tswitch__menu")).toBeVisible();
  const forgetBtns = page.locator(".tswitch__forget");
  await expect(forgetBtns).toHaveCount(2);
  await forgetBtns.nth(1).focus();
  await page.keyboard.press(" ");
  await expect(forgetBtns).toHaveCount(1);
});

test("BottomSheet manages initial focus, traps Tab/Shift+Tab, restores focus on close, and has no axe violations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedMockedTreasury(page);
  await page.goto("/#overview");

  const addFundsBtn = page.getByRole("button", { name: /^add funds$/i });
  await expect(addFundsBtn).toBeVisible();
  await addFundsBtn.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: /fund treasury/i });
  await expect(dialog).toBeVisible();

  // Initial focus should be inside the dialog (first focusable element: Close button)
  const closeBtn = dialog.getByRole("button", { name: /^close$/i });
  await expect(closeBtn).toBeFocused();

  // Run axe on the dialog
  const axeDialog = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(axeDialog.violations).toEqual([]);

  // Shift+Tab from first element wraps to last element (Fund button)
  const fundBtn = dialog.getByRole("button", { name: /^fund$/i });
  await page.keyboard.press("Shift+Tab");
  await expect(fundBtn).toBeFocused();

  // Tab from last element wraps back to first element (Close button)
  await page.keyboard.press("Tab");
  await expect(closeBtn).toBeFocused();

  // Escape closes the sheet and returns focus to Add funds button
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(addFundsBtn).toBeFocused();
});

test("Inline .err messages have role=alert and pass axe", async ({ page }) => {
  await seedMockedTreasury(page);
  await page.goto("/#settings");

  // Trigger inline validation error on Update limits
  await page.getByRole("button", { name: /update limits/i }).click();
  const alerts = page.locator('.err[role="alert"]');
  await expect(alerts.first()).toBeVisible();

  const axeSettings = await new AxeBuilder({ page }).include(".page").analyze();
  expect(axeSettings.violations).toEqual([]);
});
