// Wallet error classification — pure functions, so they're unit-testable. Map raw
// wallet/SDK errors into the three surfaced error types: wallet not installed,
// request rejected, and insufficient balance.
import { getLocale, MESSAGES, t, type Locale } from "./i18n";

export function errText(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return typeof e === "string" ? e : "";
}

/** connect: wallet not installed (type 1) or request rejected (type 2). */
export function connectErr(e: unknown, locale: Locale = getLocale()): string {
  const m = errText(e).toLowerCase();
  if (m.includes("not available") || m.includes("not installed") || m.includes("install")) {
    return t("wallet.notInstalled", undefined, locale);
  }
  if (
    m.includes("reject") || m.includes("denied") || m.includes("declin") ||
    m.includes("close") || m.includes("cancel")
  ) {
    return t("wallet.cancelled", undefined, locale);
  }
  return errText(e) || t("wallet.connectFailed", undefined, locale);
}

/** The user-facing text for a wallet session the wallet no longer honours. */
export const STALE_SESSION_MSG = MESSAGES.en["wallet.staleSession"];

/** A WalletConnect session the wallet dropped (deleted, expired or never paired). The app
 *  keeps signing against a topic that no longer exists, so nothing ever opens on the phone.
 *  Detected here so callers can clear the session instead of showing the raw core error. */
export function isStaleSessionError(e: unknown): boolean {
  const m = errText(e).toLowerCase();
  if (!m.includes("session")) return false;
  return (
    m.includes("recently deleted") ||
    m.includes("no matching key") ||
    m.includes("missing or invalid") ||
    m.includes("expired")
  );
}

/** send: insufficient balance (type 3) or signature rejected (type 2). */
export function sendErr(e: unknown, locale: Locale = getLocale()): string {
  if (isStaleSessionError(e)) return t("wallet.staleSession", undefined, locale);
  const codes = (e as {
    response?: { data?: { extras?: { result_codes?: { operations?: string[]; transaction?: string } } } };
  })?.response?.data?.extras?.result_codes;
  const opCodes = codes?.operations?.join(", ") || codes?.transaction || "";
  if (opCodes.includes("underfunded") || opCodes.toLowerCase().includes("insufficient")) {
    return t("wallet.insufficientBalance", undefined, locale);
  }
  const m = errText(e).toLowerCase();
  if (m.includes("account not found") || m.includes("account does not exist")) {
    return t("wallet.noXlmYet", undefined, locale);
  }
  if (m.includes("underfunded") || m.includes("insufficient balance")) {
    return t("wallet.insufficientBalance", undefined, locale);
  }
  if (m.includes("reject") || m.includes("denied") || m.includes("declin") || m.includes("cancel")) {
    return t("wallet.signatureRejected", undefined, locale);
  }
  return opCodes || errText(e) || t("wallet.txFailed", undefined, locale);
}

/** On-chain policy rejections (`Error(Contract, #N)`) → human-readable messages.
 *  A rejection is the product working — these read as guardrails, not failures. */
export const CONTRACT_ERRORS: Record<number, string> = {
  1: MESSAGES.en["contract.1"],
  2: MESSAGES.en["contract.2"],
  3: MESSAGES.en["contract.3"],
  4: MESSAGES.en["contract.4"],
  5: MESSAGES.en["contract.5"],
  6: MESSAGES.en["contract.6"],
  7: MESSAGES.en["contract.7"],
  8: MESSAGES.en["contract.8"],
  9: MESSAGES.en["contract.9"],
  10: MESSAGES.en["contract.10"],
  11: MESSAGES.en["contract.11"],
  12: MESSAGES.en["contract.12"],
  13: MESSAGES.en["contract.13"],
  14: MESSAGES.en["contract.14"],
  15: MESSAGES.en["contract.15"],
  16: MESSAGES.en["contract.16"],
  17: MESSAGES.en["contract.17"],
};

export const CONTRACT_ERRORS_TR: Record<number, string> = {
  1: MESSAGES.tr["contract.1"],
  2: MESSAGES.tr["contract.2"],
  3: MESSAGES.tr["contract.3"],
  4: MESSAGES.tr["contract.4"],
  5: MESSAGES.tr["contract.5"],
  6: MESSAGES.tr["contract.6"],
  7: MESSAGES.tr["contract.7"],
  8: MESSAGES.tr["contract.8"],
  9: MESSAGES.tr["contract.9"],
  10: MESSAGES.tr["contract.10"],
  11: MESSAGES.tr["contract.11"],
  12: MESSAGES.tr["contract.12"],
  13: MESSAGES.tr["contract.13"],
  14: MESSAGES.tr["contract.14"],
  15: MESSAGES.tr["contract.15"],
  16: MESSAGES.tr["contract.16"],
  17: MESSAGES.tr["contract.17"],
};

/** Parse a contract guardrail rejection out of a raw error message. Returns null
 *  when the failure isn't a contract error, so callers' retry logic stays intact. */
export function contractErr(
  msg: string,
  locale: Locale = getLocale(),
): { errorCode: number; errorMessage: string } | null {
  const m = msg.match(/Error\(Contract,\s*#?(\d+)\)/);
  if (!m) return null;
  const code = Number(m[1]);
  const table = locale === "tr" ? CONTRACT_ERRORS_TR : CONTRACT_ERRORS;
  return {
    errorCode: code,
    errorMessage: table[code] ?? t("contract.unknown", { code }, locale),
  };
}

/** A failed `deposit`, worded for the person depositing. The treasury itself only refuses a
 *  deposit with 1 or 16; every other code came from the token it moves, and the token's
 *  codes overlap the treasury's — the SAC's #10 is a short balance, not a session cap. */
export function depositErr(msg: string, unit: string, locale: Locale = getLocale()): string | null {
  const ce = contractErr(msg, locale);
  if (!ce) return null;
  if (ce.errorCode === 1 || ce.errorCode === 16) return ce.errorMessage;
  if (ce.errorCode === 10) return t("deposit.insufficientUnit", { unit }, locale);
  if (ce.errorCode === 13) return t("deposit.needsTrustline", { unit }, locale);
  return t("deposit.tokenRefused", { unit, code: ce.errorCode }, locale);
}
