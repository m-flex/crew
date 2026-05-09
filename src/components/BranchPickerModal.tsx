import { useEffect, useMemo, useState } from "react";
import { useCrew, BranchChoice } from "../store";
import { BranchInfo, BranchList, gitListBranches } from "../git";

export function BranchPickerModal() {
  const request = useCrew((s) => s.branchPicker);
  const resolve = useCrew((s) => s.resolveBranchPicker);
  const roles = useCrew((s) => s.roles);

  const [branches, setBranches] = useState<BranchList | null>(null);
  const [tab, setTab] = useState<"current" | "existing" | "new">("current");
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [base, setBase] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [roleId, setRoleId] = useState<string | null>(null);

  // Reset internal state every time a new request opens.
  useEffect(() => {
    if (!request) return;
    setBranches(null);
    setTab("current");
    setSelectedBranch(null);
    setNewName("");
    setFilter("");
    setBase(request.detect.currentBranch ?? "");
    setRoleId(null);
    let cancelled = false;
    (async () => {
      const list = await gitListBranches(request.basePath);
      if (cancelled) return;
      setBranches(list);
      if (list?.current) setBase(list.current);
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  // ESC to cancel.
  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        resolve(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, resolve]);

  const filteredLocal = useMemo<BranchInfo[]>(() => {
    if (!branches) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return branches.local;
    return branches.local.filter((b) => b.name.toLowerCase().includes(q));
  }, [branches, filter]);

  if (!request) return null;

  const detect = request.detect;
  const currentBranch = detect.currentBranch ?? (detect.detached ? "DETACHED" : "no branch");

  const submit = () => {
    let choice: BranchChoice | null = null;
    if (tab === "current") {
      choice = { kind: "current" };
    } else if (tab === "existing" && selectedBranch) {
      choice = { kind: "existing", branch: selectedBranch };
    } else if (tab === "new" && newName.trim() && base) {
      choice = { kind: "new", name: newName.trim(), base };
    }
    if (choice) resolve({ branch: choice, roleId });
  };

  const canSubmit =
    tab === "current" ||
    (tab === "existing" && selectedBranch !== null) ||
    (tab === "new" && newName.trim().length > 0 && base.length > 0);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) resolve(null);
      }}
    >
      <div className="modal branch-picker">
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Launch agent in repository</h2>
            <p className="modal-subtitle">
              <span className="branch-picker-repo" title={detect.repoRoot}>
                {detect.repoRoot}
              </span>
              <span className="dot-sep"> • </span>
              currently on{" "}
              <span className="emphasis">{currentBranch}</span>
              {detect.isDirty && (
                <span className="branch-picker-dirty"> (dirty)</span>
              )}
            </p>
          </div>
          <button className="modal-close" onClick={() => resolve(null)}>
            ×
          </button>
        </div>

        <div className="branch-picker-tabs">
          <button
            className={`branch-picker-tab ${tab === "current" ? "is-active" : ""}`}
            onClick={() => setTab("current")}
          >
            Use current branch
          </button>
          <button
            className={`branch-picker-tab ${tab === "existing" ? "is-active" : ""}`}
            onClick={() => setTab("existing")}
          >
            Existing branch
          </button>
          <button
            className={`branch-picker-tab ${tab === "new" ? "is-active" : ""}`}
            onClick={() => setTab("new")}
          >
            New branch
          </button>
        </div>

        <div className="modal-body">
          {tab === "current" && (
            <div className="branch-picker-info">
              <p>
                Spawn the agent directly in <code>{detect.repoRoot}</code> on
                its current branch <span className="emphasis">{currentBranch}</span>.
              </p>
              <p className="muted branch-picker-warn">
                No worktree is created. If another agent is already on this
                folder, your edits will collide.
              </p>
            </div>
          )}

          {tab === "existing" && (
            <>
              <input
                type="text"
                className="template-save-input"
                placeholder="Filter branches…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoFocus
              />
              <div className="branch-picker-list">
                {!branches && (
                  <div className="branch-picker-empty">Loading branches…</div>
                )}
                {branches && filteredLocal.length === 0 && (
                  <div className="branch-picker-empty">No branches match.</div>
                )}
                {filteredLocal.map((b) => (
                  <button
                    key={b.name}
                    className={`branch-picker-row ${selectedBranch === b.name ? "is-selected" : ""}`}
                    onClick={() => setSelectedBranch(b.name)}
                  >
                    <span className="branch-picker-name">{b.name}</span>
                    {b.isHead && <span className="branch-picker-head">HEAD</span>}
                    {b.upstream && (
                      <span className="branch-picker-upstream">{b.upstream}</span>
                    )}
                  </button>
                ))}
              </div>
              <p className="muted">
                A worktree will be created at{" "}
                <code>.crew-worktrees/&lt;branch&gt;/</code> so this agent stays
                isolated from other panes.
              </p>
            </>
          )}

          {tab === "new" && (
            <>
              <label className="branch-picker-field">
                <span className="branch-picker-field-label">Branch name</span>
                <input
                  type="text"
                  className="template-save-input"
                  placeholder="feat/my-experiment"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="branch-picker-field">
                <span className="branch-picker-field-label">Branch from</span>
                <select
                  className="template-save-input"
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                >
                  {branches?.local.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                      {b.isHead ? " (current)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <p className="muted">
                Crew will create the branch and a worktree at{" "}
                <code>.crew-worktrees/{newName ? sanitize(newName) : "<name>"}/</code>.
              </p>
            </>
          )}
        </div>

        <div className="branch-picker-role">
          <label className="branch-picker-field-label">Role</label>
          <select
            className="template-save-input"
            value={roleId ?? ""}
            onChange={(e) => setRoleId(e.target.value || null)}
          >
            <option value="">No role</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="modal-footer branch-picker-footer">
          <button className="link-btn" onClick={() => resolve(null)}>
            Cancel
          </button>
          <button
            className="primary-btn"
            onClick={submit}
            disabled={!canSubmit}
          >
            {tab === "current" ? "Spawn here" : "Spawn worktree"}
          </button>
        </div>
      </div>
    </div>
  );
}

function sanitize(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
