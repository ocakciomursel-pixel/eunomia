// The product chrome: persistent sidebar (desktop) / bottom tabs (mobile) + a sticky
// topbar carrying the treasury switcher and the shared wallet chip. Pages render inside.
import EunomiaMark from "../EunomiaMark";
import WalletChip from "../WalletChip";
import TreasurySwitcher from "./TreasurySwitcher";
import { LanguageSwitch } from "../LanguageSwitch";
import { useI18n } from "../../lib/i18n";
import { APP_PAGES, type AppPage, type View } from "../../lib/routes";
import "./shell.css";
import "./ledger.css";

const NAV: Record<AppPage, { labelKey: string; icon: string }> = {
  overview: { labelKey: "nav.overview", icon: "◈" },
  payments: { labelKey: "nav.payments", icon: "→" },
  agent: { labelKey: "nav.agent", icon: "⚡" },
  activity: { labelKey: "nav.activity", icon: "≡" },
  settings: { labelKey: "nav.settings", icon: "⚙" },
};

export default function AppShell({
  page,
  onGo,
  children,
}: {
  page: View;
  onGo: (v: View) => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();

  return (
    <div className="shell">
      <aside className="shell__side">
        <button className="shell__brand" onClick={() => onGo("landing")} type="button">
          <EunomiaMark size={17} />
          Eunomia
        </button>
        <nav className="shell__nav">
          {APP_PAGES.map((p) => (
            <button
              key={p}
              className={`shell__item${page === p ? " is-active" : ""}`}
              onClick={() => onGo(p)}
              type="button"
            >
              <span className="shell__icon">{NAV[p].icon}</span> {t(NAV[p].labelKey)}
            </button>
          ))}
        </nav>
        <div className="shell__foot">
          <div className="shell__beta">{t("nav.betaBanner")}</div>
          <a
            className="shell__docs"
            href="/docs/"
            target="_blank"
            rel="noreferrer"
          >
            {t("nav.docs")}
          </a>
        </div>
      </aside>

      <div className="shell__main">
        <header className="shell__top">
          <TreasurySwitcher />
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <LanguageSwitch />
            <WalletChip onWalletView={() => onGo("wallet")} />
          </div>
        </header>
        <main className="shell__content">{children}</main>
      </div>

      <nav className="shell__tabs">
        {APP_PAGES.map((p) => (
          <button
            key={p}
            className={`shell__tab${page === p ? " is-active" : ""}`}
            onClick={() => onGo(p)}
            type="button"
          >
            <span className="shell__icon">{NAV[p].icon}</span>
            {t(NAV[p].labelKey)}
          </button>
        ))}
      </nav>
    </div>
  );
}
