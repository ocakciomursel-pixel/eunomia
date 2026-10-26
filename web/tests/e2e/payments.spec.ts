import { test, expect } from "@playwright/test";
import { PAYEE_A, TREASURY_A, setupMockedTreasurySession } from "./mockRpc";

test.describe("Payments page (mocked RPC)", () => {
  test("renders allowed and blocked decisions, slice filters, verified payees, and Pay by hand validation", async ({
    page,
  }) => {
    await setupMockedTreasurySession(page);
    await page.goto("/#payments");

    await expect(page.getByText("Agent payments")).toBeVisible();
    await expect(page.getByText(/Agent paid 12\.5 XLM/)).toBeVisible();
    await expect(
      page.getByText(/Agent payment refused · Payee isn't approved — not on the whitelist/),
    ).toBeVisible();

    // Slice filters: Allowed / Blocked / All
    const counts = page.locator(".ledger__counts");
    await counts.getByRole("button", { name: /Allowed 1/ }).click();
    await expect(page.getByText(/Agent paid 12\.5 XLM/)).toBeVisible();
    await expect(
      page.getByText(/Agent payment refused · Payee isn't approved — not on the whitelist/),
    ).toHaveCount(0);

    await counts.getByRole("button", { name: /Blocked 1/ }).click();
    await expect(
      page.getByText(/Agent payment refused · Payee isn't approved — not on the whitelist/),
    ).toBeVisible();
    await expect(page.getByText(/Agent paid 12\.5 XLM/)).toHaveCount(0);

    await counts.getByRole("button", { name: /All 2/ }).click();
    await expect(page.getByText(/Agent paid 12\.5 XLM/)).toBeVisible();
    await expect(
      page.getByText(/Agent payment refused · Payee isn't approved — not on the whitelist/),
    ).toBeVisible();

    // Approved payees list + on-chain verification badge
    const shortPayee = `${PAYEE_A.slice(0, 4)}…${PAYEE_A.slice(-4)}`;
    await expect(page.getByText("on chain ✓")).toBeVisible();
    const payeeBtn = page.getByRole("button", { name: shortPayee });
    await expect(payeeBtn).toBeVisible();

    // Clicking a payee opens Pay by hand with destination pre-filled
    await payeeBtn.click();
    const destInput = page.getByLabel("Payment destination address");
    await expect(destInput).toHaveValue(PAYEE_A);

    // Entering a C… contract address shows inline validation error
    await destInput.fill(TREASURY_A);
    await expect(
      page.getByText("Contract addresses can't receive payments — use a G… account."),
    ).toBeVisible();

    // Entering an amount above the 10 XLM per-payment cap shows inline warning
    await destInput.fill(PAYEE_A);
    const amtInput = page.getByLabel("Payment amount in XLM");
    await amtInput.fill("15");
    await expect(page.getByText(/above your per-payment cap; it will be blocked/)).toBeVisible();
  });
});
