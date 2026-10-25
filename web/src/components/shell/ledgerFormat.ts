// The ledger's vocabulary, shared by every page that lists decisions: which word and mark a
// kind gets, how the clock column reads, how an amount is written. Pure functions — kept
// out of the component files so fast refresh keeps working.
import type { FeedEvent } from "../../lib/events";
import { getLocale, INTL_TAG, type Locale, t } from "../../lib/i18n";

export function verdictOf(kind: string, locale: Locale = getLocale()): { cls: string; text: string } {
  if (kind === "blocked") return { cls: "pill pill--no", text: t("verdict.blocked", undefined, locale) };
  if (kind === "paid") return { cls: "pill pill--ok", text: t("verdict.allowed", undefined, locale) };
  if (kind === "fund") return { cls: "pill pill--rule", text: t("verdict.funded", undefined, locale) };
  if (kind === "deploy") return { cls: "pill pill--rule", text: t("verdict.created", undefined, locale) };
  if (kind === "whitelist") return { cls: "pill pill--rule", text: t("verdict.payee", undefined, locale) };
  if (kind === "leash" || kind === "revoked") return { cls: "pill pill--rule", text: t("verdict.leash", undefined, locale) };
  return { cls: "pill pill--rule", text: t("verdict.rule", undefined, locale) };
}

/** HH:MM for today, "Mon 16:51" for this week, the date beyond — the ledger's clock. */
export function whenOf(iso: string, now = new Date(), locale: Locale = getLocale()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tag = INTL_TAG[locale];
  const hm = d.toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return hm;
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 7) return `${d.toLocaleDateString(tag, { weekday: "short" })} ${hm}`;
  return d.toLocaleDateString(tag, { day: "2-digit", month: "short" });
}

export function amountOf(e: FeedEvent): string {
  if (e.amountXlm == null || Number.isNaN(e.amountXlm)) return "";
  return e.amountXlm.toFixed(4);
}

/** A row's sentence, in the open treasury's token. The feed's writers (chain events, the
 *  activity log) predate the token choice and spell every amount "N XLM"; neither knows
 *  which token a treasury holds. The page does, so the unit is set where it is shown.
 *  The durable fix is a token column on the activity row — until then this keeps a USDC
 *  treasury's ledger from quoting its amounts in the wrong currency. */
export function inToken<T extends { label: string }>(e: T, code: "XLM" | "USDC"): T {
  if (code === "XLM") return e;
  return { ...e, label: e.label.replace(/(\d) XLM\b/g, `$1 ${code}`) };
}
