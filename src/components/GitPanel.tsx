import { useEffect, useMemo, useState } from "react";
import {
  BranchInfo,
  BranchList,
  CommitInfo,
  FileEntry,
  GitStatus,
  gitCheckout,
  gitCommit,
  gitDeleteBranch,
  gitDiscard,
  gitListBranches,
  gitLog,
  gitPull,
  gitStage,
  gitUnstage,
} from "../git";
import { PaneSpec, useCrew } from "../store";
import { DiffView } from "./DiffView";

interface Props {
  pane: PaneSpec;
  status: GitStatus;
}

type Tab = "status" | "branches" | "log";

export function GitPanel({ pane, status }: Props) {
  const setOpen = useCrew((s) => s.setGitPanelOpen);
  const [tab, setTab] = useState<Tab>("status");
  const cwd = pane.cwd;
  const paneKey = pane.key;

  return (
    <div className="git-panel">
      <div className="git-panel-header">
        <div className="git-panel-tabs">
          <button
            className={`git-panel-tab ${tab === "status" ? "is-active" : ""}`}
            onClick={() => setTab("status")}
          >
            Status
          </button>
          <button
            className={`git-panel-tab ${tab === "branches" ? "is-active" : ""}`}
            onClick={() => setTab("branches")}
          >
            Branches
          </button>
          <button
            className={`git-panel-tab ${tab === "log" ? "is-active" : ""}`}
            onClick={() => setTab("log")}
          >
            Log
          </button>
        </div>
        <button
          className="modal-close"
          onClick={() => setOpen(paneKey, false)}
          title="Close panel"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>
      <div className="git-panel-body">
        {tab === "status" && <StatusTab cwd={cwd} status={status} />}
        {tab === "branches" && (
          <BranchesTab pane={pane} cwd={cwd} status={status} />
        )}
        {tab === "log" && <LogTab cwd={cwd} status={status} />}
      </div>
    </div>
  );
}

function LogTab({ cwd, status }: { cwd: string; status: GitStatus }) {
  const [commits, setCommits] = useState<CommitInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCommits(null);
    setErr(null);
    (async () => {
      try {
        const list = await gitLog(cwd, 50, null);
        if (!cancelled) setCommits(list);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // Refetch when the head moves (commits, checkouts, etc.).
  }, [cwd, status.branch, status.detached, status.ahead, status.behind]);

  return (
    <div className="log-tab">
      {err && <div className="branches-error">{err}</div>}
      {!commits && !err && (
        <div className="branch-picker-empty">Loading log…</div>
      )}
      {commits && commits.length === 0 && (
        <div className="branch-picker-empty">No commits yet.</div>
      )}
      {commits?.map((c) => (
        <div
          key={c.oid}
          className={`log-row ${c.parents > 1 ? "log-row-merge" : ""}`}
          title={`${c.author} <${c.email}>`}
        >
          <span className="log-oid">{c.shortOid}</span>
          <span className="log-summary">{c.summary || "(no message)"}</span>
          <span className="log-time">{relativeTime(c.timeSeconds)}</span>
        </div>
      ))}
    </div>
  );
}

function relativeTime(seconds: number): string {
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - seconds);
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d`;
  if (diff < 86400 * 365) return `${Math.floor(diff / 86400 / 30)}mo`;
  return `${Math.floor(diff / 86400 / 365)}y`;
}

function StatusTab({ cwd, status }: { cwd: string; status: GitStatus }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [diffSelection, setDiffSelection] = useState<{
    path: string;
    staged: boolean;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pull = async () => {
    setBusy(true);
    setErr(null);
    setPullMsg(null);
    try {
      const msg = await gitPull(cwd);
      setPullMsg(msg || "Already up to date.");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const stagePaths = (paths: string[]) =>
    run(() => gitStage(cwd, paths));
  const unstagePaths = (paths: string[]) =>
    run(() => gitUnstage(cwd, paths));
  const discardPaths = (paths: string[]) =>
    run(() => gitDiscard(cwd, paths));

  const allUnstagedPaths = [
    ...status.unstaged.map((e) => e.path),
    ...status.untracked.map((e) => e.path),
  ];
  const allStagedPaths = status.staged.map((e) => e.path);

  const totalChanges =
    status.staged.length +
    status.unstaged.length +
    status.untracked.length +
    status.conflicted.length;

  const onCommit = async () => {
    if (!message.trim() && !amend) return;
    setBusy(true);
    setErr(null);
    try {
      await gitCommit(cwd, message.trim(), amend);
      setMessage("");
      setAmend(false);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (diffSelection) {
    return (
      <DiffView
        cwd={cwd}
        path={diffSelection.path}
        staged={diffSelection.staged}
        onClose={() => setDiffSelection(null)}
      />
    );
  }

  return (
    <div className="status-tab">
      {err && <div className="branches-error">{err}</div>}
      {pullMsg && <div className="pull-msg">{pullMsg}</div>}

      {status.behind > 0 && (
        <div className="pull-banner">
          <span className="pull-banner-text">
            {status.behind} commit{status.behind !== 1 ? "s" : ""} behind{" "}
            {status.upstream ?? "upstream"}
          </span>
          <button
            className="primary-btn pull-banner-btn"
            onClick={pull}
            disabled={busy}
          >
            Pull
          </button>
        </div>
      )}

      {totalChanges === 0 && (
        <div className="status-empty">
          <span className="dot dot-idle" />
          <span>Working tree is clean</span>
        </div>
      )}

      {status.conflicted.length > 0 && (
        <FileSection
          title="Conflicted"
          tone="conflict"
          entries={status.conflicted}
          actions={[]}
          onSelect={(p) => setDiffSelection({ path: p, staged: false })}
          busy={busy}
        />
      )}

      {status.staged.length > 0 && (
        <FileSection
          title="Staged"
          tone="staged"
          entries={status.staged}
          actions={[
            {
              label: "Unstage",
              onPaths: unstagePaths,
              kind: "default",
            },
          ]}
          bulkActions={[
            {
              label: "Unstage all",
              onClick: () => unstagePaths(allStagedPaths),
            },
          ]}
          onSelect={(p) => setDiffSelection({ path: p, staged: true })}
          busy={busy}
        />
      )}

      {status.unstaged.length > 0 && (
        <FileSection
          title="Unstaged"
          tone="unstaged"
          entries={status.unstaged}
          actions={[
            { label: "Stage", onPaths: stagePaths, kind: "primary" },
            { label: "Discard", onPaths: discardPaths, kind: "danger" },
          ]}
          onSelect={(p) => setDiffSelection({ path: p, staged: false })}
          busy={busy}
        />
      )}

      {status.untracked.length > 0 && (
        <FileSection
          title="Untracked"
          tone="untracked"
          entries={status.untracked}
          actions={[
            { label: "Stage", onPaths: stagePaths, kind: "primary" },
            { label: "Delete", onPaths: discardPaths, kind: "danger" },
          ]}
          onSelect={(p) => setDiffSelection({ path: p, staged: false })}
          busy={busy}
        />
      )}

      {(status.unstaged.length > 0 || status.untracked.length > 0) && (
        <div className="status-bulk">
          <button
            className="link-btn"
            onClick={() => stagePaths(allUnstagedPaths)}
            disabled={busy}
          >
            Stage all
          </button>
        </div>
      )}

      <CommitComposer
        message={message}
        setMessage={setMessage}
        amend={amend}
        setAmend={setAmend}
        canCommit={
          (status.staged.length > 0 || amend) &&
          (message.trim().length > 0 || amend)
        }
        busy={busy}
        onCommit={onCommit}
      />
    </div>
  );
}

function CommitComposer({
  message,
  setMessage,
  amend,
  setAmend,
  canCommit,
  busy,
  onCommit,
}: {
  message: string;
  setMessage: (s: string) => void;
  amend: boolean;
  setAmend: (b: boolean) => void;
  canCommit: boolean;
  busy: boolean;
  onCommit: () => void;
}) {
  return (
    <div className="commit-composer">
      <textarea
        className="commit-input"
        placeholder="Commit message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
      />
      <div className="commit-row">
        <label className="commit-amend">
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => setAmend(e.target.checked)}
          />
          <span>Amend</span>
        </label>
        <button
          className="primary-btn commit-btn"
          onClick={onCommit}
          disabled={!canCommit || busy}
        >
          {amend ? "Amend commit" : "Commit"}
        </button>
      </div>
    </div>
  );
}

interface FileAction {
  label: string;
  onPaths: (paths: string[]) => void;
  kind: "primary" | "danger" | "default";
}

interface BulkAction {
  label: string;
  onClick: () => void;
}

function FileSection({
  title,
  tone,
  entries,
  actions,
  bulkActions,
  onSelect,
  busy,
}: {
  title: string;
  tone: "staged" | "unstaged" | "untracked" | "conflict";
  entries: FileEntry[];
  actions: FileAction[];
  bulkActions?: BulkAction[];
  onSelect?: (path: string) => void;
  busy: boolean;
}) {
  return (
    <section className={`status-section status-section-${tone}`}>
      <header className="status-section-header">
        <span className="status-section-title">{title}</span>
        <span className="status-section-count">{entries.length}</span>
        {bulkActions?.map((a) => (
          <button
            key={a.label}
            className="link-btn status-bulk-action"
            onClick={a.onClick}
            disabled={busy}
          >
            {a.label}
          </button>
        ))}
      </header>
      <ul className="status-files">
        {entries.map((e) => (
          <li key={e.path} className="status-file">
            <span
              className={`status-file-glyph status-file-glyph-${e.status}`}
              title={e.status}
            >
              {glyphFor(e.status)}
            </span>
            <button
              className="status-file-path"
              title={e.path}
              onClick={() => onSelect?.(e.path)}
              disabled={!onSelect}
            >
              {e.path}
            </button>
            <span className="status-file-actions">
              {actions.map((a) => (
                <button
                  key={a.label}
                  className={`status-file-action status-file-action-${a.kind}`}
                  onClick={() => a.onPaths([e.path])}
                  disabled={busy}
                  title={a.label}
                >
                  {a.label}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function glyphFor(status: string): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "typechange":
      return "T";
    case "untracked":
      return "?";
    case "conflicted":
      return "!";
    default:
      return "•";
  }
}

function BranchesTab({
  pane,
  cwd,
  status,
}: {
  pane: PaneSpec;
  cwd: string;
  status: GitStatus;
}) {
  const spawnInWorktree = useCrew((s) => s.spawnInWorktree);
  const [list, setList] = useState<BranchList | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  // Default mode: if the pane is already its own worktree, "in place" stays
  // isolated. Otherwise, default to "worktree" so we don't yank the floor
  // out from under any other agent on the main repo.
  const [createMode, setCreateMode] = useState<"inplace" | "worktree">(
    pane.worktree ? "inplace" : "worktree",
  );

  // The worktree commands need the MAIN repo's path, not the current pane's
  // cwd (which might already be a worktree). When the pane was spawned via
  // a worktree, we stored the originating repo on it.
  const mainRepoRoot = pane.worktree?.repoRoot ?? status.repoRoot;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const b = await gitListBranches(cwd);
      if (!cancelled) setList(b);
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, reloadKey, status.branch]);

  const reload = () => setReloadKey((k) => k + 1);

  const filtered = useMemo<BranchInfo[]>(() => {
    if (!list) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return list.local;
    return list.local.filter((b) => b.name.toLowerCase().includes(q));
  }, [list, filter]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    setPullMsg(null);
    try {
      await fn();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pull = async () => {
    setBusy(true);
    setErr(null);
    setPullMsg(null);
    try {
      const msg = await gitPull(cwd);
      setPullMsg(msg || "Already up to date.");
      reload();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const checkout = (branch: string) =>
    run(async () => {
      await gitCheckout(cwd, branch, false);
      reload();
    });

  const spawnWorktreeOn = (branch: string, isNew: boolean, base: string | null) =>
    run(() =>
      spawnInWorktree({
        repoRoot: mainRepoRoot,
        branch,
        base,
        newBranch: isNew,
      }),
    );

  const submitNew = () => {
    const name = newName.trim();
    if (!name) return;
    if (createMode === "worktree") {
      run(async () => {
        await spawnInWorktree({
          repoRoot: mainRepoRoot,
          branch: name,
          base: status.branch,
          newBranch: true,
        });
        setNewName("");
        setCreating(false);
      });
    } else {
      run(async () => {
        await gitCheckout(cwd, name, true);
        setNewName("");
        setCreating(false);
        reload();
      });
    }
  };

  const deleteBranch = (branch: string) =>
    run(async () => {
      await gitDeleteBranch(cwd, branch);
      reload();
    });

  return (
    <div className="branches-tab">
      <div className="branches-toolbar">
        <input
          type="text"
          className="template-save-input"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className="link-btn"
          onClick={() => setCreating((c) => !c)}
          disabled={busy}
        >
          {creating ? "Cancel" : "+ New"}
        </button>
      </div>

      {creating && (
        <div className="branches-new">
          <div className="branches-new-row">
            <input
              type="text"
              className="template-save-input"
              placeholder="branch name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNew();
                if (e.key === "Escape") setCreating(false);
              }}
              autoFocus
            />
            <button
              className="primary-btn"
              onClick={submitNew}
              disabled={busy || !newName.trim()}
            >
              {createMode === "worktree" ? "Spawn worktree" : "Checkout here"}
            </button>
          </div>
          <div className="branches-mode">
            <label className="branches-mode-opt">
              <input
                type="radio"
                name={`mode-${pane.key}`}
                checked={createMode === "worktree"}
                onChange={() => setCreateMode("worktree")}
              />
              <span>
                <strong>New worktree</strong>
                <span className="muted">
                  {" "}
                  — open as a separate agent in <code>.crew-worktrees/</code>
                </span>
              </span>
            </label>
            <label className="branches-mode-opt">
              <input
                type="radio"
                name={`mode-${pane.key}`}
                checked={createMode === "inplace"}
                onChange={() => setCreateMode("inplace")}
              />
              <span>
                <strong>In place</strong>
                <span className="muted">
                  {" "}
                  — checkout in this pane's working dir
                </span>
              </span>
            </label>
          </div>
        </div>
      )}

      {err && <div className="branches-error">{err}</div>}
      {pullMsg && <div className="pull-msg">{pullMsg}</div>}

      <div className="branches-list">
        {!list && <div className="branch-picker-empty">Loading…</div>}
        {list && filtered.length === 0 && (
          <div className="branch-picker-empty">No matching branches.</div>
        )}
        {filtered.map((b) => (
          <div
            key={b.name}
            className={`branches-row ${b.isHead ? "is-head" : ""}`}
          >
            <button
              className="branches-name"
              onClick={() => !b.isHead && checkout(b.name)}
              disabled={busy || b.isHead}
              title={b.isHead ? "Already on this branch" : "Checkout in place"}
            >
              <span className="branches-bullet">{b.isHead ? "●" : "○"}</span>
              <span>{b.name}</span>
              {b.upstream && (
                <span className="branch-picker-upstream">{b.upstream}</span>
              )}
            </button>
            <span className="branches-row-actions">
              {b.isHead && b.upstream && (
                <button
                  className="branches-action-worktree"
                  onClick={pull}
                  disabled={busy}
                  title={`Pull from ${b.upstream}`}
                  aria-label={`Pull ${b.name} from ${b.upstream}`}
                >
                  ↓ pull
                </button>
              )}
              {!b.isHead && (
                <button
                  className="branches-action-worktree"
                  onClick={() => spawnWorktreeOn(b.name, false, null)}
                  disabled={busy}
                  title="Spawn a new agent on this branch in a worktree"
                  aria-label={`Spawn worktree on ${b.name}`}
                >
                  → wt
                </button>
              )}
              {!b.isHead && (
                <button
                  className="branches-delete"
                  onClick={() => deleteBranch(b.name)}
                  disabled={busy}
                  title="Delete branch"
                  aria-label={`Delete branch ${b.name}`}
                >
                  ×
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      {list && list.remote.length > 0 && (
        <details className="branches-remote-section">
          <summary>Remote ({list.remote.length})</summary>
          <div className="branches-list">
            {list.remote.map((b) => (
              <div key={b.name} className="branches-row branches-row-remote">
                <span className="branches-name branches-name-remote">
                  <span className="branches-bullet">○</span>
                  <span>{b.name}</span>
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
