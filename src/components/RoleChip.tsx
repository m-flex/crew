import { useEffect, useRef, useState } from "react";
import { useCrew } from "../store";

interface Props {
  paneKey: string;
  // When true, renders a compact icon-only chip that always shows (used in
  // pane headers). When false, only renders a chip if a role is assigned —
  // assignment-from-empty happens via a different control.
  alwaysShow?: boolean;
}

export function RoleChip({ paneKey, alwaysShow }: Props) {
  const role = useCrew((s) => {
    const pane = s.panes.find((p) => p.key === paneKey);
    if (!pane?.roleId) return null;
    return s.roles.find((r) => r.id === pane.roleId) ?? null;
  });
  const roles = useCrew((s) => s.roles);
  const assignPaneRole = useCrew((s) => s.assignPaneRole);

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
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!role && !alwaysShow) return null;

  const swatchColor = role?.color ?? "#9da6b3";

  return (
    <div className="role-chip-wrap" ref={wrapRef}>
      <button
        className={`role-chip ${role ? "role-chip-assigned" : "role-chip-empty"}`}
        onMouseDown={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={
          role
            ? `Role: ${role.name} — click to change`
            : "Assign role"
        }
      >
        <span
          className="role-chip-swatch"
          style={{ background: swatchColor }}
        />
        <span className="role-chip-name">{role?.name ?? "No role"}</span>
      </button>
      {open && (
        <div
          className="role-chip-menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className={`role-chip-menu-item ${!role ? "is-active" : ""}`}
            onClick={() => {
              assignPaneRole(paneKey, null);
              setOpen(false);
            }}
          >
            <span
              className="role-chip-swatch"
              style={{ background: "#9da6b3" }}
            />
            <span>No role</span>
          </button>
          {roles.length === 0 ? (
            <div className="role-chip-menu-empty">
              No roles defined yet.
            </div>
          ) : (
            roles.map((r) => (
              <button
                key={r.id}
                className={`role-chip-menu-item ${
                  r.id === role?.id ? "is-active" : ""
                }`}
                onClick={() => {
                  assignPaneRole(paneKey, r.id);
                  setOpen(false);
                }}
              >
                <span
                  className="role-chip-swatch"
                  style={{ background: r.color ?? "#9da6b3" }}
                />
                <span>{r.name}</span>
              </button>
            ))
          )}
          {role?.systemPrompt && (
            <div className="role-chip-menu-foot muted">
              System prompt is baked into the running process — it won't
              change until respawn.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
