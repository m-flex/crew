import { ask } from "@tauri-apps/plugin-dialog";
import { useCrew, View } from "../store";
import { ShortcutsHelp } from "./ShortcutsHelp";

const VIEW_PILLS: { key: View; label: string }[] = [
  { key: "grid", label: "Grid" },
  { key: "radar", label: "Radar" },
  { key: "swarm", label: "Swarm" },
];

export function Topbar() {
  const panes = useCrew((s) => s.panes);
  const newAgent = useCrew((s) => s.newAgent);
  const closeAll = useCrew((s) => s.closeAll);
  const view = useCrew((s) => s.view);
  const setView = useCrew((s) => s.setView);
  const setTemplatesModalOpen = useCrew((s) => s.setTemplatesModalOpen);
  const templateCount = useCrew((s) => s.templates.length);
  const awaitingCount = useCrew(
    (s) => Object.values(s.statuses).filter((st) => st === "awaiting").length
  );

  const onCloseAll = async () => {
    if (panes.length === 0) return;
    const ok = await ask(
      panes.length === 1
        ? "Close the running agent?"
        : `Close all ${panes.length} agents?`,
      { title: "Crew", kind: "warning" }
    );
    if (ok) closeAll();
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">Crew</span>
        {panes.length > 0 && (
          <span className="brand-count">{panes.length}</span>
        )}
      </div>

      {panes.length > 0 && (
        <div className="view-switcher" role="tablist">
          {VIEW_PILLS.map((p) => (
            <button
              key={p.key}
              className={`view-btn ${view === p.key ? "view-btn-active" : ""}`}
              role="tab"
              aria-selected={view === p.key}
              onClick={() => setView(p.key)}
            >
              {p.label}
              {p.key === "radar" && awaitingCount > 0 && (
                <span
                  className="view-badge"
                  aria-label={`${awaitingCount} awaiting input`}
                >
                  {awaitingCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="topbar-right">
        <ShortcutsHelp />
        <button
          className="action action-subtle"
          onClick={() => setTemplatesModalOpen(true)}
          title="Templates"
        >
          Templates
          {templateCount > 0 && (
            <span className="action-count">{templateCount}</span>
          )}
        </button>
        {panes.length > 0 && (
          <button
            className="action action-subtle action-danger"
            onClick={onCloseAll}
            title="Close all agents"
          >
            Close all
          </button>
        )}
        <button
          className="action"
          onClick={() => newAgent()}
          title="New agent (Ctrl+T)"
        >
          <span className="action-plus">+</span>
          <span>New agent</span>
          <kbd className="kbd">⌃T</kbd>
        </button>
      </div>
    </header>
  );
}
