import { useEffect, useState } from "react";
import { ask } from "@tauri-apps/plugin-dialog";
import { useCrew, Template } from "../store";

export function TemplatesModal() {
  const open = useCrew((s) => s.templatesModalOpen);
  const setOpen = useCrew((s) => s.setTemplatesModalOpen);
  const templates = useCrew((s) => s.templates);
  const defaultTemplateId = useCrew((s) => s.defaultTemplateId);
  const panes = useCrew((s) => s.panes);
  const saveTemplate = useCrew((s) => s.saveTemplate);
  const loadTemplate = useCrew((s) => s.loadTemplate);
  const deleteTemplate = useCrew((s) => s.deleteTemplate);
  const renameTemplate = useCrew((s) => s.renameTemplate);
  const setDefaultTemplate = useCrew((s) => s.setDefaultTemplate);

  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

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

  const onSave = () => {
    const id = saveTemplate(newName);
    if (id) setNewName("");
  };

  const onLoad = async (tpl: Template) => {
    if (panes.length > 0) {
      const ok = await ask(
        `Replace ${panes.length} running agent${panes.length === 1 ? "" : "s"} with "${tpl.name}" (${tpl.agents.length} agent${tpl.agents.length === 1 ? "" : "s"})?`,
        { title: "Crew", kind: "warning" }
      );
      if (!ok) return;
    }
    await loadTemplate(tpl.id);
    setOpen(false);
  };

  const onDelete = async (tpl: Template) => {
    const ok = await ask(`Delete template "${tpl.name}"?`, {
      title: "Crew",
      kind: "warning",
    });
    if (ok) deleteTemplate(tpl.id);
  };

  const commitRename = (tpl: Template) => {
    if (renameValue.trim() && renameValue.trim() !== tpl.name) {
      renameTemplate(tpl.id, renameValue);
    }
    setRenamingId(null);
  };

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Templates</h2>
            <p className="modal-subtitle">
              Save folder combos, set a default, boot straight into them.
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

        <div className="modal-body">
          {panes.length > 0 && (
            <section className="template-save">
              <div className="template-save-row">
                <input
                  type="text"
                  placeholder={`Name a template for these ${panes.length} agent${panes.length === 1 ? "" : "s"}…`}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSave();
                  }}
                  className="template-save-input"
                  autoFocus
                />
                <button
                  className="primary-btn"
                  onClick={onSave}
                  disabled={!newName.trim()}
                >
                  Save
                </button>
              </div>
            </section>
          )}

          <section className="template-list">
            {templates.length === 0 ? (
              <div className="template-empty">
                <p className="template-empty-title">No templates yet</p>
                <p className="template-empty-hint">
                  Spin up agents in the folders you use most, then save the
                  setup here.
                </p>
              </div>
            ) : (
              templates.map((tpl) => {
                const isDefault = tpl.id === defaultTemplateId;
                const isRenaming = renamingId === tpl.id;
                return (
                  <div
                    key={tpl.id}
                    className={`template-row ${isDefault ? "template-row-default" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onLoad(tpl)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onLoad(tpl);
                    }}
                  >
                    <button
                      className={`template-star ${isDefault ? "template-star-on" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDefaultTemplate(tpl.id);
                      }}
                      title={
                        isDefault
                          ? "Default — boot loads this. Click to unset."
                          : "Set as default — load on boot"
                      }
                      aria-label={
                        isDefault ? "Unset default" : "Set as default"
                      }
                    >
                      ★
                    </button>

                    <div className="template-info">
                      <div className="template-name-row">
                        {isRenaming ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => commitRename(tpl)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                (e.target as HTMLInputElement).blur();
                              }
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            className="template-rename-input"
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span
                            className="template-name"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingId(tpl.id);
                              setRenameValue(tpl.name);
                            }}
                            title="Click to rename"
                          >
                            {tpl.name}
                          </span>
                        )}
                        <span className="template-count">
                          {tpl.agents.length}
                        </span>
                      </div>
                      <div className="template-paths">
                        {tpl.agents.map((a, i) => (
                          <span
                            key={i}
                            className="template-path"
                            title={a.cwd}
                          >
                            {labelFromCwd(a.cwd)}
                          </span>
                        ))}
                      </div>
                    </div>

                    <button
                      className="template-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(tpl);
                      }}
                      title="Delete template"
                      aria-label="Delete template"
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </section>
        </div>

        <div className="modal-footer">
          <span className="muted">
            Click a row to load · ★ marks the boot default · click name to
            rename
          </span>
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
