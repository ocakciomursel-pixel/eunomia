import { createContext, useContext } from "react";

export type Locale = "en" | "tr";
export const LOCALES: readonly Locale[] = ["en", "tr"] as const;
export const LOCALE_STORAGE_KEY = "eunomia_locale";

export const INTL_TAG: Record<Locale, string> = {
  en: "en-US",
  tr: "tr-TR",
};

export const MESSAGES: Record<Locale, Record<string, string>> = {
  en: {
    "nav.overview": "Overview",
    "nav.payments": "Payments",
    "nav.agent": "Agent",
    "nav.activity": "Activity",
    "nav.settings": "Settings",
    "nav.docs": "Docs ↗",
    "nav.betaBanner": "⚠ Mainnet beta — real funds, capped deposits.",
    "nav.language": "Language",
    "nav.connectWallet": "Connect wallet",
    "nav.connecting": "Connecting…",
    "nav.copyAddress": "Copy address",
    "nav.copied": "Copied ✓",
    "nav.walletDetails": "Wallet details",
    "nav.disconnect": "Disconnect",
    "verdict.blocked": "Blocked",
    "verdict.allowed": "Allowed",
    "verdict.funded": "Funded",
    "verdict.created": "Created",
    "verdict.payee": "Payee",
    "verdict.leash": "Leash",
    "verdict.rule": "Rule",
    "wallet.notInstalled": "That wallet isn't installed — pick another option.",
    "wallet.cancelled": "Connection cancelled.",
    "wallet.connectFailed": "Couldn't connect a wallet.",
    "wallet.staleSession": "Wallet connection expired — reconnect your wallet and try again.",
    "wallet.insufficientBalance": "Insufficient balance for this payment.",
    "wallet.noXlmYet": "Your wallet has no XLM yet — send some XLM to it first.",
    "wallet.signatureRejected": "Signature rejected in your wallet.",
    "wallet.txFailed": "Transaction failed.",
    "deposit.insufficientUnit": "Your wallet doesn't hold that much {unit}.",
    "deposit.needsTrustline": "Your wallet can't hold {unit} yet — it needs a {unit} trustline first.",
    "deposit.tokenRefused": "The {unit} token refused the deposit (#{code}).",
    "contract.unknown": "Contract error #{code}",
    "contract.1": "Amount must be greater than zero.",
    "contract.2": "Payee isn't approved — not on the whitelist.",
    "contract.3": "Over the per-task limit — the payment never left the treasury.",
    "contract.4": "Over today's daily limit — the payment never left the treasury.",
    "contract.5": "Payee's reputation score is below the required threshold.",
    "contract.6": "Not enough free balance — funds are locked in open escrows.",
    "contract.7": "Escrow not found — it may already be released or refunded.",
    "contract.8": "Escrow deadline hasn't passed yet — refund isn't available.",
    "contract.9": "Treasury is paused — spending is temporarily frozen by the owner.",
    "contract.10": "Over the agent session's spending cap — the payment never left the treasury.",
    "contract.11": "Invalid limits — both must be positive and per-payment can't exceed daily.",
    "contract.12": "Escrow deadline must be in the future.",
    "contract.13": "The payee can't hold this token yet — their account needs a trustline first.",
    "contract.14": "Over this payee's monthly cap — the payment never left the treasury.",
    "contract.15": "Over this month's budget — the payment never left the treasury.",
    "contract.16": "That would take the treasury over its deposit cap — this beta holds a limited amount per treasury.",
    "contract.17": "Outside the task budget — this agent may only pay the payees the owner approved for the task.",
  },
  tr: {
    "nav.overview": "Genel Bakış",
    "nav.payments": "Ödemeler",
    "nav.agent": "Ajan",
    "nav.activity": "Hareketler",
    "nav.settings": "Ayarlar",
    "nav.docs": "Belgeler ↗",
    "nav.betaBanner": "⚠ Mainnet beta — gerçek fonlar, üst sınırlı yatırımlar.",
    "nav.language": "Dil",
    "nav.connectWallet": "Cüzdan bağla",
    "nav.connecting": "Bağlanıyor…",
    "nav.copyAddress": "Adresi kopyala",
    "nav.copied": "Kopyalandı ✓",
    "nav.walletDetails": "Cüzdan detayları",
    "nav.disconnect": "Bağlantıyı kes",
    "verdict.blocked": "Engellendi",
    "verdict.allowed": "Onaylandı",
    "verdict.funded": "Fonlandı",
    "verdict.created": "Oluşturuldu",
    "verdict.payee": "Alıcı",
    "verdict.leash": "Yetki",
    "verdict.rule": "Kural",
    "wallet.notInstalled": "Bu cüzdan yüklü değil — başka bir seçenek belirleyin.",
    "wallet.cancelled": "Bağlantı iptal edildi.",
    "wallet.connectFailed": "Cüzdan bağlanamadı.",
    "wallet.staleSession": "Cüzdan oturumunun süresi doldu — cüzdanınızı yeniden bağlayıp tekrar deneyin.",
    "wallet.insufficientBalance": "Bu ödeme için bakiye yetersiz.",
    "wallet.noXlmYet": "Cüzdanınızda henüz XLM yok — önce biraz XLM gönderin.",
    "wallet.signatureRejected": "İmza cüzdanınızda reddedildi.",
    "wallet.txFailed": "İşlem başarısız oldu.",
    "deposit.insufficientUnit": "Cüzdanınızda bu miktarda {unit} bulunmuyor.",
    "deposit.needsTrustline": "Cüzdanınız henüz {unit} tutamıyor — önce {unit} güven hattı (trustline) gerekiyor.",
    "deposit.tokenRefused": "{unit} kontratı yatırımı reddetti (#{code}).",
    "contract.unknown": "Kontrat hatası #{code}",
    "contract.1": "Tutar sıfırdan büyük olmalıdır.",
    "contract.2": "Alıcı onaylı değil — izin listesinde (whitelist) bulunmuyor.",
    "contract.3": "Görev başına limit aşıldı — ödeme hazineden hiç çıkmadı.",
    "contract.4": "Bugünkü günlük limit aşıldı — ödeme hazineden hiç çıkmadı.",
    "contract.5": "Alıcının itibar puanı gerekli eşiğin altında.",
    "contract.6": "Yeterli serbest bakiye yok — fonlar açık emanetlerde (escrow) kilitli.",
    "contract.7": "Emanet (escrow) bulunamadı — serbest bırakılmış veya iade edilmiş olabilir.",
    "contract.8": "Emanet son tarihi henüz geçmedi — iade yapılamaz.",
    "contract.9": "Hazine duraklatıldı — harcamalar hazine sahibi tarafından geçici olarak donduruldu.",
    "contract.10": "Ajan oturumunun harcama üst sınırı aşıldı — ödeme hazineden hiç çıkmadı.",
    "contract.11": "Geçersiz limitler — her ikisi de pozitif olmalı ve tekil ödeme günlük limiti aşmamalıdır.",
    "contract.12": "Emanet son tarihi gelecekte bir zaman olmalıdır.",
    "contract.13": "Alıcı bu tokenı henüz tutamıyor — hesabında önce bir güven hattı (trustline) açılmalı.",
    "contract.14": "Bu alıcının aylık üst sınırı aşıldı — ödeme hazineden hiç çıkmadı.",
    "contract.15": "Bu ayın bütçesi aşıldı — ödeme hazineden hiç çıkmadı.",
    "contract.16": "Bu işlem hazineyi yatırım üst sınırının üzerine çıkarır — beta sürümünde hazine başına tutar sınırlıdır.",
    "contract.17": "Görev bütçesi dışında — bu ajan yalnızca hazine sahibinin görev için onayladığı alıcılara ödeme yapabilir.",
  },
};

const listeners = new Set<(locale: Locale) => void>();
let currentLocale: Locale | null = null;

function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "tr";
}

function readStorageLocale(): Locale | null {
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.getItem === "function") {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(saved)) return saved;
    }
  } catch {
    // ignore storage access errors in restricted contexts
  }
  return null;
}

export function getLocale(): Locale {
  const saved = readStorageLocale();
  if (saved) {
    currentLocale = saved;
    return saved;
  }
  if (currentLocale) return currentLocale;
  return "en";
}

export function setLocale(next: Locale): void {
  if (!isLocale(next)) return;
  currentLocale = next;
  try {
    if (typeof localStorage !== "undefined" && typeof localStorage.setItem === "function") {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    }
  } catch {
    // ignore storage write errors
  }
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.lang = next;
  }
  for (const fn of listeners) fn(next);
}

export function subscribeLocale(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function t(
  key: string,
  vars?: Record<string, string | number>,
  locale: Locale = getLocale(),
): string {
  const template = MESSAGES[locale]?.[key] ?? MESSAGES.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}

/** Format a number using the locale's conventions (`en-US`: `1,234.56`, `tr-TR`: `1.234,56`). */
export function formatNumber(
  value: number,
  locale: Locale = getLocale(),
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat(INTL_TAG[locale], options).format(value);
}

/** Format a token amount with fixed fraction digits in the given locale. */
export function formatAmount(
  value: number,
  decimals = 4,
  locale: Locale = getLocale(),
): string {
  return formatNumber(value, locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatAmount: (value: number, decimals?: number) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  const locale = getLocale();
  return {
    locale,
    setLocale,
    t: (key, vars) => t(key, vars, locale),
    formatNumber: (v, opts) => formatNumber(v, locale, opts),
    formatAmount: (v, dec) => formatAmount(v, dec, locale),
  };
}
