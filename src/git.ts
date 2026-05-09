import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export interface DetectInfo {
  repoRoot: string;
  currentBranch: string | null;
  detached: boolean;
  isDirty: boolean;
}

export interface FileEntry {
  path: string;
  status: string;
}

export interface GitStatus {
  repoRoot: string;
  branch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: FileEntry[];
  unstaged: FileEntry[];
  untracked: FileEntry[];
  conflicted: FileEntry[];
}

export interface BranchInfo {
  name: string;
  isHead: boolean;
  upstream: string | null;
}

export interface BranchList {
  local: BranchInfo[];
  remote: BranchInfo[];
  current: string | null;
  detached: boolean;
}

export interface WorktreeCreated {
  worktreePath: string;
  branch: string;
}

export async function gitDetect(path: string): Promise<DetectInfo | null> {
  try {
    return await invoke<DetectInfo | null>("git_detect", { path });
  } catch {
    return null;
  }
}

export async function gitStatus(cwd: string): Promise<GitStatus | null> {
  try {
    return await invoke<GitStatus>("git_status", { cwd });
  } catch {
    return null;
  }
}

export function dirtyFileCount(s: GitStatus): number {
  return (
    s.staged.length +
    s.unstaged.length +
    s.untracked.length +
    s.conflicted.length
  );
}

export async function gitListBranches(cwd: string): Promise<BranchList | null> {
  try {
    return await invoke<BranchList>("git_list_branches", { cwd });
  } catch {
    return null;
  }
}

export async function gitCreateWorktree(args: {
  repoRoot: string;
  branch: string;
  base: string | null;
  newBranch: boolean;
  paneId: string;
}): Promise<WorktreeCreated> {
  return invoke<WorktreeCreated>("git_create_worktree", {
    repoRoot: args.repoRoot,
    branch: args.branch,
    base: args.base,
    newBranch: args.newBranch,
    paneId: args.paneId,
  });
}

export async function gitRemoveWorktree(
  paneId: string,
  force: boolean,
): Promise<boolean> {
  return invoke<boolean>("git_remove_worktree", { paneId, force });
}

export async function gitForgetWorktree(paneId: string): Promise<void> {
  await invoke("git_forget_worktree", { paneId });
}

export async function gitCheckout(
  cwd: string,
  branch: string,
  create: boolean,
): Promise<void> {
  await invoke("git_checkout", { cwd, branch, create });
}

export async function gitDeleteBranch(
  cwd: string,
  branch: string,
): Promise<void> {
  await invoke("git_delete_branch", { cwd, branch });
}

export async function gitStage(cwd: string, paths: string[]): Promise<void> {
  await invoke("git_stage", { cwd, paths });
}

export async function gitUnstage(cwd: string, paths: string[]): Promise<void> {
  await invoke("git_unstage", { cwd, paths });
}

export async function gitDiscard(cwd: string, paths: string[]): Promise<void> {
  await invoke("git_discard", { cwd, paths });
}

export interface DiffLine {
  origin: string;
  content: string;
  oldLineno: number | null;
  newLineno: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath: string | null;
  isBinary: boolean;
  isNew: boolean;
  isDeleted: boolean;
  hunks: DiffHunk[];
}

export interface DiffResult {
  files: DiffFile[];
}

export async function gitDiff(
  cwd: string,
  path: string | null,
  staged: boolean,
): Promise<DiffResult> {
  return invoke<DiffResult>("git_diff", { cwd, path, staged });
}

export async function gitCommit(
  cwd: string,
  message: string,
  amend: boolean,
): Promise<{ oid: string }> {
  return invoke<{ oid: string }>("git_commit", { cwd, message, amend });
}

export interface CommitInfo {
  oid: string;
  shortOid: string;
  author: string;
  email: string;
  timeSeconds: number;
  summary: string;
  parents: number;
}

export async function gitLog(
  cwd: string,
  limit: number,
  branch: string | null = null,
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("git_log", { cwd, limit, branch });
}

// Polls git status while mounted. Probes once via git_detect; if the cwd is
// not a repo, no polling is scheduled. Default interval is 2.5s — small repos
// take <5ms, large ones (~10k files) under 50ms, both well under the cadence.
export function useGitStatus(cwd: string, intervalMs = 2500): GitStatus | null {
  const [status, setStatus] = useState<GitStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    (async () => {
      const detect = await gitDetect(cwd);
      if (cancelled || !detect) return;

      const tick = async () => {
        if (cancelled) return;
        const s = await gitStatus(cwd);
        if (cancelled) return;
        setStatus(s);
        timer = window.setTimeout(tick, intervalMs);
      };
      tick();
    })();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      setStatus(null);
    };
  }, [cwd, intervalMs]);

  return status;
}
