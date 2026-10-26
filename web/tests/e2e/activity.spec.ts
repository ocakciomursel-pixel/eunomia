import { test, expect } from "@playwright/test";
import { setupMockedTreasurySession } from "./mockRpc";

test.describe("Activity page (mocked RPC)", () => {
  test("renders live on-chain events and filters by kind group and treasury", async ({ page }) => {
    await setupMockedTreasurySession(page);
    await page.goto("/#activity");

    await expect(page.getByText("Every decision on Eunomia")).toBeVisible();
    await expect(page.getByText(/Agent paid 12\.5 XLM/)).toBeVisible();
    await expect(page.getByText(/Payee approved:/)).toBeVisible();
    await expect(page.getByText("Treasury paused")).toBeVisible();

    const showPanel = page.locator(".page__side .panel");

    // Filter to Payees only
    await showPanel.getByRole("button", { name: "Payees", exact: true }).click();
    await expect(page.getByText(/Payee approved:/)).toBeVisible();
    await expect(page.getByText(/Agent paid 12\.5 XLM/)).toHaveCount(0);
    await expect(page.getByText("Treasury paused")).toHaveCount(0);

    // Filter to ZK (none in feed) -> empty filter message
    await showPanel.getByRole("button", { name: "Payees", exact: true }).click();
    await showPanel.getByRole("button", { name: "ZK", exact: true }).click();
    await expect(page.getByText("Nothing matches these filters.")).toBeVisible();

    // Reset with All chip
    await showPanel.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByText(/Agent paid 12\.5 XLM/)).toBeVisible();
    await expect(page.getByText("Treasury paused")).toBeVisible();

    // Filter to active treasury only (hides TREASURY_B's "Treasury paused" event)
    await showPanel.getByRole("button", { name: "my treasury only" }).click();
    await expect(page.getByText(/Agent paid 12\.5 XLM/)).toBeVisible();
    await expect(page.getByText(/Payee approved:/)).toBeVisible();
    await expect(page.getByText("Treasury paused")).toHaveCount(0);
  });
});
