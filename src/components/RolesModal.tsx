import { useEffect, useMemo, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useCrew, RolePreset } from "../store";

const PALETTE = [
  "#7c9eff",
  "#5fc37c",
  "#d49b56",
  "#b58cff",
  "#e07a7a",
  "#56c4c4",
  "#d8c350",
  "#9da6b3",
];

export function RolesModal() {
  const open = useCrew((s) => s.rolesModalOpen);
  const setOpen = useCrew((s) => s.setRolesModalOpen);
  const roles = useCrew((s) => s.roles);
  const createRole = useCrew((s) => s.createRole);
  const updateRole = useCrew((s) => s.updateRole);
  const deleteRole = useCrew((s) => s.deleteRole);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Keep selection valid as the list changes.
  useEffect(() => {
    if (!open) return;
    if (selectedId && roles.some((r) => r.id === selectedId)) return;
    setSelectedId(roles[0]?.id ?? null);
  }, [open, roles, selectedId]);

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

  const selected = useMemo(
    () => roles.find((r) => r.id === selectedId) ?? null,
    [roles, selectedId],
  );

  if (!open) return null;

  const onCreate = () => {
    const id = createRole({
      name: "Untitled role",
      color: PALETTE[roles.length % PALETTE.length],
      systemPrompt: "",
      promptPrefix: "",
    });
    setSelectedId(id);
  };

  const onDelete = async (role: RolePreset) => {
    const ok = await ask(
      `Delete role "${role.name}"? Panes wearing it will be unassigned.`,
      { title: "Crew", kind: "warning" },
    );
    if (ok) deleteRole(role.id);
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div
        className="modal modal-wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Roles</h2>
            <p className="modal-subtitle">
              Saved system prompts + broadcast prefixes. Assign one to a pane
              to specialise it.
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

        <div className="roles-body">
          <aside className="roles-list">
            <button className="roles-new" onClick={onCreate}>
              <span className="action-plus">+</span>
              <span>New role</span>
            </button>
            {roles.length === 0 ? (
              <div className="roles-empty">No roles yet.</div>
            ) : (
              roles.map((r) => (
                <button
                  key={r.id}
                  className={`roles-list-row ${
                    r.id === selectedId ? "is-selected" : ""
                  }`}
                  onClick={() => setSelectedId(r.id)}
                >
                  <span
                    className="roles-list-swatch"
                    style={{ background: r.color ?? "#9da6b3" }}
                  />
                  <span className="roles-list-name">{r.name}</span>
                </button>
              ))
            )}
          </aside>

          <section className="roles-detail">
            {selected ? (
              <RoleEditor
                key={selected.id}
                role={selected}
                onChange={(patch) => updateRole(selected.id, patch)}
                onDelete={() => onDelete(selected)}
              />
            ) : (
              <div className="roles-detail-empty">
                <p>Pick a role on the left, or create a new one.</p>
              </div>
            )}
          </section>
        </div>

        <div className="modal-footer">
          <span className="muted">
            <span className="emphasis">System prompt</span> is appended to claude
            at spawn — bake-in.
            <span className="dot-sep"> · </span>
            <span className="emphasis">Broadcast prefix</span> is prepended to
            every Swarm message — per-turn.
          </span>
        </div>
      </div>
    </div>
  );
}

interface EditorProps {
  role: RolePreset;
  onChange: (patch: Partial<Omit<RolePreset, "id">>) => void;
  onDelete: () => void;
}

function RoleEditor({ role, onChange, onDelete }: EditorProps) {
  const argsText = (role.spawnArgs ?? []).join(" ");

  return (
    <div className="role-editor">
      <div className="role-editor-row">
        <label className="role-editor-field role-editor-name">
          <span className="role-editor-label">Name</span>
          <input
            type="text"
            className="role-editor-input"
            value={role.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Reviewer"
          />
        </label>
        <div className="role-editor-field role-editor-color">
          <span className="role-editor-label">Color</span>
          <div className="role-editor-palette">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className={`role-editor-swatch ${
                  role.color === c ? "is-active" : ""
                }`}
                style={{ background: c }}
                onClick={() => onChange({ color: c })}
                aria-label={`Set color ${c}`}
              />
            ))}
          </div>
        </div>
      </div>

      <label className="role-editor-field">
        <span className="role-editor-label">
          System prompt
          <span className="muted role-editor-hint">
            — appended at spawn via <code>--append-system-prompt</code>
          </span>
        </span>
        <textarea
          className="role-editor-textarea"
          value={role.systemPrompt ?? ""}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
          rows={5}
          placeholder="You are reviewing code in this worktree…"
          spellCheck={false}
        />
      </label>

      <label className="role-editor-field">
        <span className="role-editor-label">
          Broadcast prefix
          <span className="muted role-editor-hint">
            — prepended to every Swarm message sent to panes wearing this role
          </span>
        </span>
        <textarea
          className="role-editor-textarea"
          value={role.promptPrefix ?? ""}
          onChange={(e) => onChange({ promptPrefix: e.target.value })}
          rows={3}
          placeholder="Review the pending changes in this worktree…"
          spellCheck={false}
        />
      </label>

      <label className="role-editor-field">
        <span className="role-editor-label">
          Extra spawn args
          <span className="muted role-editor-hint">
            — space-separated, e.g. <code>--model claude-sonnet-4-6</code>
          </span>
        </span>
        <input
          type="text"
          className="role-editor-input"
          value={argsText}
          onChange={(e) =>
            onChange({
              spawnArgs: e.target.value
                .split(/\s+/)
                .filter((tok) => tok.length > 0),
            })
          }
          placeholder=""
          spellCheck={false}
        />
      </label>

      <div className="role-editor-actions">
        <button
          className="action action-subtle action-danger"
          onClick={onDelete}
        >
          Delete role
        </button>
      </div>
    </div>
  );
}
