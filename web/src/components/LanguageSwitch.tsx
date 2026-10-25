import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  formatAmount,
  formatNumber,
  getLocale,
  I18nContext,
  type I18nContextValue,
  type Locale,
  setLocale,
  subscribeLocale,
  t,
  useI18n,
} from "../lib/i18n";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => getLocale());

  useEffect(() => {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = locale;
    }
    return subscribeLocale(setLocaleState);
  }, [locale]);

  const changeLocale = useCallback((next: Locale) => {
    setLocale(next);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: changeLocale,
      t: (key, vars) => t(key, vars, locale),
      formatNumber: (v, opts) => formatNumber(v, locale, opts),
      formatAmount: (v, dec) => formatAmount(v, dec, locale),
    }),
    [locale, changeLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale, setLocale: updateLocale, t: tr } = useI18n();
  const next: Locale = locale === "en" ? "tr" : "en";
  return (
    <button
      type="button"
      className={className || "shell__lang"}
      aria-label={tr("nav.language")}
      title={locale === "en" ? "Türkçe'ye geç" : "Switch to English"}
      onClick={() => updateLocale(next)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "4px 8px",
        borderRadius: "6px",
        border: "1px solid rgba(255, 255, 255, 0.14)",
        background: "transparent",
        color: "inherit",
        fontSize: "12px",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <span style={{ opacity: locale === "en" ? 1 : 0.5 }}>EN</span>
      <span style={{ opacity: 0.35 }}>/</span>
      <span style={{ opacity: locale === "tr" ? 1 : 0.5 }}>TR</span>
    </button>
  );
}
