import { describe, it, expect, beforeEach } from "vitest";
import {
  formatAmount,
  formatNumber,
  getLocale,
  LOCALE_STORAGE_KEY,
  MESSAGES,
  setLocale,
  subscribeLocale,
  t,
} from "./i18n";
import {
  connectErr,
  CONTRACT_ERRORS_TR,
  contractErr,
  depositErr,
  sendErr,
} from "./wallet-errors";
import { verdictOf } from "../components/shell/ledgerFormat";

describe("i18n message catalogs", () => {
  it("provides a non-empty Turkish translation for every English key", () => {
    const enKeys = Object.keys(MESSAGES.en).sort();
    const trKeys = Object.keys(MESSAGES.tr).sort();
    expect(trKeys).toEqual(enKeys);
    for (const k of enKeys) {
      expect(MESSAGES.tr[k].trim().length).toBeGreaterThan(0);
    }
  });

  it("interpolates template placeholders in both locales", () => {
    expect(t("deposit.insufficientUnit", { unit: "USDC" }, "en")).toBe(
      "Your wallet doesn't hold that much USDC.",
    );
    expect(t("deposit.insufficientUnit", { unit: "USDC" }, "tr")).toBe(
      "Cüzdanınızda bu miktarda USDC bulunmuyor.",
    );
    expect(t("deposit.tokenRefused", { unit: "XLM", code: 6 }, "tr")).toBe(
      "XLM kontratı yatırımı reddetti (#6).",
    );
  });

  it("falls back to the key when a translation key is unknown", () => {
    expect(t("nonexistent.key", undefined, "tr")).toBe("nonexistent.key");
  });
});

describe("locale switching and persistence", () => {
  beforeEach(() => {
    setLocale("en");
  });

  it("persists the active locale and notifies subscribers", () => {
    const seen: string[] = [];
    const unsub = subscribeLocale((loc) => seen.push(loc));
    setLocale("tr");
    expect(getLocale()).toBe("tr");
    expect(seen).toEqual(["tr"]);
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("tr");
    }
    unsub();
    setLocale("en");
    expect(getLocale()).toBe("en");
  });
});

describe("locale-aware number formatting", () => {
  it("formats thousands and decimals according to en-US vs tr-TR conventions", () => {
    expect(formatNumber(1234.56, "en")).toBe("1,234.56");
    expect(formatNumber(1234.56, "tr")).toBe("1.234,56");
    expect(formatAmount(1234.5, 4, "en")).toBe("1,234.5000");
    expect(formatAmount(1234.5, 4, "tr")).toBe("1.234,5000");
  });

  it("returns empty string for non-finite values", () => {
    expect(formatNumber(Number.NaN, "tr")).toBe("");
    expect(formatAmount(Number.POSITIVE_INFINITY, 2, "en")).toBe("");
  });
});

describe("Turkish wallet, deposit, contract errors and verdicts", () => {
  it("maps every contract error code (1..17) in Turkish", () => {
    for (let code = 1; code <= 17; code++) {
      expect(contractErr(`Error(Contract, #${code})`, "tr")).toEqual({
        errorCode: code,
        errorMessage: CONTRACT_ERRORS_TR[code],
      });
    }
    expect(contractErr("Error(Contract, #99)", "tr")).toEqual({
      errorCode: 99,
      errorMessage: "Kontrat hatası #99",
    });
  });

  it("localizes connectErr, sendErr, and depositErr into Turkish", () => {
    expect(connectErr(new Error("Freighter is not installed"), "tr")).toMatch(/yüklü değil/);
    expect(connectErr(new Error("User rejected"), "tr")).toBe("Bağlantı iptal edildi.");
    expect(sendErr(new Error("User declined to sign"), "tr")).toMatch(/reddedildi/);
    expect(depositErr("HostError: Error(Contract, #10)", "XLM", "tr")).toBe(
      "Cüzdanınızda bu miktarda XLM bulunmuyor.",
    );
    expect(depositErr("HostError: Error(Contract, #13)", "USDC", "tr")).toMatch(/güven hattı/);
  });

  it("localizes ledger verdicts into Turkish", () => {
    expect(verdictOf("blocked", "tr").text).toBe("Engellendi");
    expect(verdictOf("paid", "tr").text).toBe("Onaylandı");
    expect(verdictOf("fund", "tr").text).toBe("Fonlandı");
  });
});
