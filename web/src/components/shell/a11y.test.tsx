import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TreasuryContext, type TreasuryContextValue } from "../../state/treasuryContext";
import BottomSheet from "./BottomSheet";
import TreasurySwitcher from "./TreasurySwitcher";

const SRC_DIR = resolve(__dirname, "../..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [full] : [];
  });
}

function makeStubContext(overrides: Partial<TreasuryContextValue> = {}): TreasuryContextValue {
  const noopOutcome = async () => ({ ok: true, msg: "" });
  return {
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    treasuryId: "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K",
    state: null,
    tokenCode: "XLM",
    lifecycle: null,
    legacy: false,
    sessionActive: false,
    walletXlm: 100,
    loading: false,
    busy: null,
    refreshKey: 0,
    treasuries: [
      { id: "CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K", registered: true },
      { id: "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE", registered: false },
    ],
    refresh: async () => {},
    connect: async () => {},
    deploy: noopOutcome,
    openExisting: () => ({ ok: true, msg: "" }),
    fund: noopOutcome,
    whitelist: noopOutcome,
    removePayeeAddr: noopOutcome,
    spend: noopOutcome,
    startLeash: noopOutcome,
    revokeLeash: noopOutcome,
    approveBudget: noopOutcome,
    updateMonthly: noopOutcome,
    capPayee: noopOutcome,
    togglePause: noopOutcome,
    withdraw: noopOutcome,
    updateLimits: noopOutcome,
    registerActive: noopOutcome,
    switchTreasury: vi.fn(),
    forgetTreasury: vi.fn(),
    creatingNew: false,
    startNewTreasury: vi.fn(),
    cancelNewTreasury: vi.fn(),
    ...overrides,
  };
}

describe("TreasurySwitcher accessibility", () => {
  it("exposes aria-expanded and aria-haspopup on the trigger button", () => {
    const html = renderToStaticMarkup(
      <TreasuryContext.Provider value={makeStubContext()}>
        <TreasurySwitcher />
      </TreasuryContext.Provider>,
    );
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="true"');
  });

  it("does not nest a role=button or button inside another button, prevents default on Space, and closes on Escape", () => {
    const src = readFileSync(resolve(__dirname, "./TreasurySwitcher.tsx"), "utf8");
    // No role="button" span nested inside a button
    expect(src).not.toContain('role="button"');
    // Both select and forget are sibling buttons inside a div.tswitch__row
    expect(src).toContain('<div key={t.id} className="tswitch__row">');
    expect(src).toContain('className="tswitch__select"');
    expect(src).toContain('className="tswitch__forget"');
    // Space/Enter preventDefault and Escape handler
    expect(src).toContain("e.preventDefault()");
    expect(src).toContain('e.key === "Escape"');
  });
});

describe("BottomSheet accessibility", () => {
  it("renders a focusable modal dialog with aria-modal and aria-label", () => {
    const html = renderToStaticMarkup(
      <BottomSheet open={true} onClose={() => {}} title="Fund treasury">
        <input aria-label="Fund amount" />
      </BottomSheet>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Fund treasury"');
    expect(html).toContain('tabindex="-1"');
  });

  it("manages initial focus, focus trap on Tab/Shift+Tab, and returns focus on close", () => {
    const src = readFileSync(resolve(__dirname, "./BottomSheet.tsx"), "utf8");
    expect(src).toContain("document.activeElement");
    expect(src).toContain("previousFocus.focus()");
    expect(src).toContain('e.key === "Tab"');
    expect(src).toContain("e.shiftKey");
    expect(src).toContain("first.focus()");
    expect(src).toContain("last.focus()");
  });
});

describe("Inline .err messages accessibility", () => {
  it("marks every inline .err element across src/ with role=alert", () => {
    const files = tsxFiles(SRC_DIR);
    let checked = 0;
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (/className=(?:"err"|\{[^}]*"err"[^}]*\})/.test(line)) {
          checked++;
          expect(
            line,
            `${file}:${idx + 1} renders .err without role="alert"`,
          ).toMatch(/role=(?:"alert"|\{[^}]*"alert"[^}]*\})/);
        }
      });
    }
    expect(checked).toBeGreaterThanOrEqual(16);
  });
});
