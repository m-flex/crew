import { useEffect, useRef } from "react";
import { useCrew } from "../store";

export function BroadcastPalette() {
  const open = useCrew((s) => s.broadcastPaletteOpen);
  const setOpen = useCrew((s) => s.setBroadcastPaletteOpen);
  const panes = useCrew((s) => s.panes);
  const selected = useCrew((s) => s.selected);
  const toggleSelection = useCrew((s) => s.toggleSelection);
  const selectAll = useCrew((s) => s.selectAll);
  const selectNone = useCrew((s) => s.selectNone);
  const composerText = useCrew((s) => s.composerText);
  const setComposerText = useCrew((s) => s.setComposerText);
  const roles = useCrew((s) => s.roles);
  const overrideRoleId = useCrew((s) => s.broadcastOverrideRoleId);
  const setOverrideRoleId = useCrew((s) => s.setBroadcastOverrideRoleId);
  const broadcast = useCrew((s) => s.broadcast);

  const taRef = useRef<HTMLTextAreaElement>(null);

  // Autosize the textarea (capped) — same behaviour as the old Swarm composer.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, [composerText, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  if (!open) return null;
  if (panes.length === 0) {
    // No panes — close silently rather than showing an empty palette.
    return null;
  }

  const selectedCount = panes.filter((p) => selected[p.key]).length;
  const canSend = composerText.trim().length > 0 && selectedCount > 0;

  const send = async () => {
    if (!canSend) return;
    await broadcast();
    setOpen(false);
  };

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div
        className="modal modal-broadcast"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Broadcast</h2>
            <p className="modal-subtitle">
              Send the same message to selected panes — Ctrl+Enter to fire.
            </p>
          </div>
          <button
            className="modal-close"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="broadcast-body">
          <div className="composer-role-row">
            <span className="composer-role-label muted">Role framing:</span>
            <button
              type="button"
              className={`composer-role-pill ${
                overrideRoleId === null ? "is-active" : ""
              }`}
              onClick={() => setOverrideRoleId(null)}
              title="Each pane uses its own assigned role's prefix"
            >
              Per-pane
            </button>
            {roles.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`composer-role-pill ${
                  overrideRoleId === r.id ? "is-active" : ""
                }`}
                onClick={() => setOverrideRoleId(r.id)}
                title={`Override every selected pane with ${r.name}'s prefix for this broadcast`}
              >
                <span
                  className="role-chip-swatch"
                  style={{ background: r.color ?? "#9da6b3" }}
                />
                {r.name}
              </button>
            ))}
          </div>

          <textarea
            ref={taRef}
            className="composer-input broadcast-textarea"
            placeholder="Broadcast a prompt to selected agents — Ctrl+Enter to send"
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            onKeyDown={onComposerKey}
            rows={3}
            spellCheck={false}
            autoFocus
          />

          <div className="broadcast-targets">
            <div className="broadcast-targets-head">
              <span className="muted">Send to:</span>
              <span className="emphasis">{selectedCount}</span>
              <span className="muted"> of {panes.length}</span>
              <button className="link-btn" onClick={selectAll}>
                All
              </button>
              <span className="dot-sep">·</span>
              <button className="link-btn" onClick={selectNone}>
                None
              </button>
            </div>
            <div className="broadcast-targets-list">
              {panes.map((p, i) => {
                const role = p.roleId
                  ? roles.find((r) => r.id === p.roleId)
                  : null;
                const isOn = !!selected[p.key];
                return (
                  <label
                    key={p.key}
                    className={`broadcast-target ${isOn ? "is-on" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => toggleSelection(p.key)}
                    />
                    <span className="pane-index">{i + 1}</span>
                    <span className="broadcast-target-cwd" title={p.cwd}>
                      {labelFromCwd(p.cwd)}
                    </span>
                    {role && (
                      <span
                        className="broadcast-target-role"
                        style={{ background: role.color ?? "#9da6b3" }}
                        title={`Role: ${role.name}`}
                      >
                        {role.name}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        <div className="modal-footer broadcast-footer">
          <button className="link-btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button
            className="primary-btn"
            onClick={send}
            disabled={!canSend}
          >
            <span>Send to {selectedCount}</span>
            <kbd className="kbd kbd-on-primary">⌃↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

function labelFromCwd(cwd: string): string {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return cwd;
  if (parts.length === 1) return parts[0];
  return parts.slice(-2).join("/");
}
