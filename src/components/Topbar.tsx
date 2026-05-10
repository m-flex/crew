import { ask } from "@tauri-apps/plugin-dialog";
import { useCrew, View } from "../store";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { ensureNotificationPermission } from "../notify";

const VIEW_PILLS: { key: View; label: string }[] = [
  { key: "grid", label: "Grid" },
  { key: "radar", label: "Radar" },
];

export function Topbar() {
  const panes = useCrew((s) => s.panes);
  const newAgent = useCrew((s) => s.newAgent);
  const closeAll = useCrew((s) => s.closeAll);
  const view = useCrew((s) => s.view);
  const setView = useCrew((s) => s.setView);
  const setTemplatesModalOpen = useCrew((s) => s.setTemplatesModalOpen);
  const setRolesModalOpen = useCrew((s) => s.setRolesModalOpen);
  const setBroadcastPaletteOpen = useCrew((s) => s.setBroadcastPaletteOpen);
  const templateCount = useCrew((s) => s.templates.length);
  const roleCount = useCrew((s) => s.roles.length);
  const notificationsEnabled = useCrew((s) => s.notificationsEnabled);
  const toggleNotifications = useCrew((s) => s.toggleNotifications);
  const dangerouslySkipPermissions = useCrew(
    (s) => s.dangerouslySkipPermissions,
  );
  const toggleDangerouslySkipPermissions = useCrew(
    (s) => s.toggleDangerouslySkipPermissions,
  );
  const respawnAll = useCrew((s) => s.respawnAll);
  const awaitingCount = useCrew(
    (s) => Object.values(s.statuses).filter((st) => st === "awaiting").length
  );

  const onToggleNotifications = async () => {
    if (!notificationsEnabled) {
      // Prompt the OS for permission the moment the user opts in,
      // not the first time an agent goes idle.
      const granted = await ensureNotificationPermission();
      if (!granted) return;
    }
    toggleNotifications();
  };

  const onToggleDangerouslySkipPermissions = async () => {
    if (panes.length > 0) {
      const enabling = !dangerouslySkipPermissions;
      const ok = await ask(
        enabling
          ? "Enabling --dangerously-skip-permissions will respawn all running agents. Continue?"
          : "Disabling --dangerously-skip-permissions will respawn all running agents. Continue?",
        { title: "Crew", kind: "warning" },
      );
      if (!ok) return;
    }
    toggleDangerouslySkipPermissions();
    if (panes.length > 0) {
      respawnAll();
    }
  };

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
          className={`action action-subtle action-icon ${
            dangerouslySkipPermissions ? "action-icon-warn" : ""
          }`}
          onClick={onToggleDangerouslySkipPermissions}
          title={
            dangerouslySkipPermissions
              ? "--dangerously-skip-permissions on (click to disable)"
              : "--dangerously-skip-permissions off (click to enable)"
          }
          aria-label="Toggle dangerously-skip-permissions"
          aria-pressed={dangerouslySkipPermissions}
        >
          <LockIcon unlocked={dangerouslySkipPermissions} />
        </button>
        <button
          className={`action action-subtle action-icon ${
            notificationsEnabled ? "action-icon-active" : ""
          }`}
          onClick={onToggleNotifications}
          title={
            notificationsEnabled
              ? "Notifications on (idle)"
              : "Notifications off"
          }
          aria-label="Toggle idle notifications"
          aria-pressed={notificationsEnabled}
        >
          <BellIcon muted={!notificationsEnabled} />
        </button>
        {panes.length > 0 && (
          <button
            className="action action-subtle"
            onClick={() => setBroadcastPaletteOpen(true)}
            title="Broadcast (Ctrl+Enter)"
          >
            Broadcast
            <kbd className="kbd">⌃↵</kbd>
          </button>
        )}
        <button
          className="action action-subtle"
          onClick={() => setRolesModalOpen(true)}
          title="Roles"
        >
          Roles
          {roleCount > 0 && (
            <span className="action-count">{roleCount}</span>
          )}
        </button>
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

function LockIcon({ unlocked }: { unlocked?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
      {/* shackle */}
      <path
        d={
          unlocked
            ? "M4.5 6V4a2.5 2.5 0 0 1 5 0"
            : "M4.5 6V4a2.5 2.5 0 0 1 5 0V6"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      {/* body */}
      <rect
        x="3"
        y="6"
        width="8"
        height="6"
        rx="1.2"
        fill={unlocked ? "none" : "currentColor"}
        fillOpacity={unlocked ? 0 : 0.18}
        stroke="currentColor"
        strokeWidth="1.2"
      />
      {/* keyhole */}
      {!unlocked && (
        <circle cx="7" cy="9" r="1" fill="currentColor" fillOpacity={0.6} />
      )}
    </svg>
  );
}

interface BellIconProps {
  muted?: boolean;
}
function BellIcon({ muted }: BellIconProps) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
      <path
        d="M3 10.5 H11 L10 9.2 V6.5 a3 3 0 0 0 -6 0 V9.2 L3 10.5 Z M5.8 12 a1.2 1.2 0 0 0 2.4 0"
        fill={muted ? "none" : "currentColor"}
        fillOpacity={muted ? 0 : 0.18}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {muted && (
        <path
          d="M2 2 L12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
