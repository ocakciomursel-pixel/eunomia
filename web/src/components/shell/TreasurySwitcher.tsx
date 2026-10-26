// Topbar treasury selector: the merged local ∪ on-chain list, switchable without a
// reload. Registry entries are the recoverable ones; local-only rows say so. "Forget"
// only drops the device-local mapping — the contract itself lives on.
import { useEffect, useRef, useState } from "react";
import { shortAddr } from "../../config";
import { useTreasury } from "../../state/useTreasury";

export default function TreasurySwitcher() {
  const { address, treasuryId, treasuries, switchTreasury, forgetTreasury, startNewTreasury } = useTreasury();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        chipRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", closeOnClickOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnClickOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!address || !treasuryId) return <span />;

  return (
    <div className="tswitch" ref={ref}>
      <button
        ref={chipRef}
        className="tswitch__chip"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        ◇ {shortAddr(treasuryId)} <span className="tswitch__caret">▾</span>
      </button>
      {open && (
        <div className="tswitch__menu">
          {treasuries.map((t) => (
            <div key={t.id} className="tswitch__row">
              <button
                className="tswitch__select"
                onClick={() => {
                  setOpen(false);
                  switchTreasury(t.id);
                }}
                type="button"
              >
                <span style={{ flex: 1 }}>{shortAddr(t.id)}</span>
                {!t.registered && <span className="is-unreg">not registered</span>}
                {t.id === treasuryId && <span className="is-current">✓</span>}
              </button>
              <button
                className="tswitch__forget"
                type="button"
                title="Forget on this device only — the contract stays on-chain"
                aria-label={`Forget treasury ${shortAddr(t.id)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  forgetTreasury(t.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    forgetTreasury(t.id);
                  }
                }}
              >
                forget
              </button>
            </div>
          ))}
          <button
            className="tswitch__row tswitch__new"
            onClick={() => {
              setOpen(false);
              startNewTreasury();
            }}
            type="button"
          >
            ＋ New treasury
          </button>
        </div>
      )}
    </div>
  );
}
