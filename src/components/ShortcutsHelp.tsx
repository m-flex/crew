import { useEffect, useRef, useState } from "react";

const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

type Shortcut = { keys: string[]; label: string };

const GLOBAL: Shortcut[] = [
  { keys: [MOD, "T"], label: "New agent" },
  { keys: [MOD, "W"], label: "Close focused agent" },
  { keys: [MOD, "M"], label: "Maximize / restore focused agent" },
  { keys: [MOD, "Enter"], label: "Open broadcast palette" },
  { keys: [MOD, "1"], label: "Focus agent by index (1–9)" },
  { keys: [MOD, "]"], label: "Focus next agent" },
  { keys: [MOD, "["], label: "Focus previous agent" },
  { keys: [MOD, "\\"], label: "Cycle view (Grid ↔ Radar)" },
];

const BROADCAST: Shortcut[] = [
  { keys: [MOD, "Enter"], label: "Send to selected agents" },
];

const TERMINAL: Shortcut[] = [
  { keys: [MOD, "C"], label: "Copy selection (sends interrupt if no selection)" },
  { keys: [MOD, "V"], label: "Paste from clipboard" },
  { keys: [MOD, "Click"], label: "Open URL in browser" },
];

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="shortcuts-help" ref={wrapRef}>
      <button
        className="action action-subtle shortcuts-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Keyboard shortcuts"
      >
        <span aria-hidden="true">?</span>
        <span className="sr-only">Keyboard shortcuts</span>
      </button>

      {open && (
        <div className="shortcuts-popover" role="dialog" aria-label="Keyboard shortcuts">
          <div className="shortcuts-section">
            <div className="shortcuts-heading">Global</div>
            <ul className="shortcuts-list">
              {GLOBAL.map((s) => (
                <li key={s.label} className="shortcuts-row">
                  <span className="shortcuts-label">{s.label}</span>
                  <span className="shortcuts-keys">
                    {s.keys.map((k, i) => (
                      <kbd key={i} className="kbd kbd-lg">{k}</kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="shortcuts-section">
            <div className="shortcuts-heading">Terminal</div>
            <ul className="shortcuts-list">
              {TERMINAL.map((s) => (
                <li key={s.label} className="shortcuts-row">
                  <span className="shortcuts-label">{s.label}</span>
                  <span className="shortcuts-keys">
                    {s.keys.map((k, i) => (
                      <kbd key={i} className="kbd kbd-lg">{k}</kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="shortcuts-section">
            <div className="shortcuts-heading">Broadcast palette</div>
            <ul className="shortcuts-list">
              {BROADCAST.map((s) => (
                <li key={s.label} className="shortcuts-row">
                  <span className="shortcuts-label">{s.label}</span>
                  <span className="shortcuts-keys">
                    {s.keys.map((k, i) => (
                      <kbd key={i} className="kbd kbd-lg">{k}</kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
