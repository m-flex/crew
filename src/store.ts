import { create } from "zustand";
import { persist } from "zustand/middleware";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { AgentStatus } from "./status";
import { notifyAgentIdle, labelFromCwd } from "./notify";
import {
  DetectInfo,
  gitCreateWorktree,
  gitDetect,
  gitForgetWorktree,
  gitListBranches,
  gitRemoveWorktree,
} from "./git";

export interface WorktreeMeta {
  repoRoot: string;
  branch: string;
  autoCreated: boolean;
}

export interface PaneSpec {
  key: string;
  cwd: string;
  command: string;
  // User-supplied args. Role-injected args (--append-system-prompt etc.) are
  // composed at spawn time in TerminalPane via composeSpawnArgs() so editing a
  // role updates the next spawn without rewriting saved specs.
  args: string[];
  createdAt: number;
  worktree?: WorktreeMeta;
  roleId?: string;
}

export interface RolePreset {
  id: string;
  name: string;
  // Hex color used for the chip + radar ring. Optional — when absent the chip
  // renders in a neutral tone.
  color?: string;
  // Appended to claude via --append-system-prompt at spawn time. Baked into
  // the running process; editing later only affects future spawns.
  systemPrompt?: string;
  // Prepended to every Swarm broadcast directed at panes wearing this role,
  // separated by a blank line: `${promptPrefix}\n\n${userMessage}`.
  promptPrefix?: string;
  // Free-form extra CLI args (e.g. ["--model", "claude-sonnet-4-6"]). Passed
  // verbatim before --append-system-prompt.
  spawnArgs?: string[];
}

export type BranchChoice =
  | { kind: "current" }
  | { kind: "existing"; branch: string }
  | { kind: "new"; name: string; base: string };

export interface LaunchChoice {
  branch: BranchChoice;
  roleId: string | null;
}

export interface BranchPickerRequest {
  basePath: string;
  detect: DetectInfo;
  resolve: (choice: LaunchChoice | null) => void;
}

export interface SpawnOptions {
  command?: string;
  args?: string[];
  key?: string;
  worktree?: WorktreeMeta;
  roleId?: string;
}

export type View = "grid" | "radar";

export interface TemplateAgent {
  cwd: string;
  command: string;
  args: string[];
  // If set, the saved pane was a worktree on this branch. On load, Crew
  // creates a worktree on the branch (creating it if missing). When absent,
  // the agent spawns directly in `cwd` as before.
  branch?: string;
  roleId?: string;
}

export interface Template {
  id: string;
  name: string;
  agents: TemplateAgent[];
  createdAt: number;
}

interface CrewState {
  // Live (not persisted)
  panes: PaneSpec[];
  focusedKey: string | null;
  maximizedKey: string | null;
  view: View;
  statuses: Record<string, AgentStatus>;
  thinkingStartedAt: Record<string, number>;
  lastActivity: Record<string, number>;
  lastBroadcast: Record<string, { text: string; at: number }>;
  selected: Record<string, boolean>;
  composerText: string;
  templatesModalOpen: boolean;
  hasBooted: boolean;
  branchPicker: BranchPickerRequest | null;
  gitPanelOpen: Record<string, boolean>;
  // Ephemeral: when set, broadcast() uses this role's promptPrefix for every
  // selected pane regardless of each pane's assigned role.
  broadcastOverrideRoleId: string | null;
  rolesModalOpen: boolean;
  broadcastPaletteOpen: boolean;

  // Persisted
  templates: Template[];
  defaultTemplateId: string | null;
  notificationsEnabled: boolean;
  roles: RolePreset[];
  // Set the first time we seed starter presets so we don't re-seed after the
  // user has deliberately deleted them all.
  rolesSeeded: boolean;

  // Pane lifecycle
  newAgent: () => Promise<void>;
  spawnAgent: (cwd: string, opts?: SpawnOptions) => string;
  closeAgent: (key: string) => Promise<void>;
  closeAll: () => Promise<void>;

  // Branch picker
  openBranchPicker: (
    basePath: string,
    detect: DetectInfo,
  ) => Promise<LaunchChoice | null>;
  resolveBranchPicker: (choice: LaunchChoice | null) => void;

  // Git panel
  toggleGitPanel: (key: string) => void;
  setGitPanelOpen: (key: string, open: boolean) => void;

  // Spawn a new agent in a freshly-created worktree. Generates the pane id,
  // creates the worktree, then registers the pane — used by GitPanel's
  // Branches tab as well as the new-agent flow.
  spawnInWorktree: (args: {
    repoRoot: string;
    branch: string;
    base: string | null;
    newBranch: boolean;
    roleId?: string | null;
  }) => Promise<void>;

  // Focus / nav
  focus: (key: string) => void;
  focusByIndex: (idx: number) => void;
  shiftFocus: (delta: number) => void;
  toggleMaximize: (key?: string) => void;

  // Views
  setView: (v: View) => void;
  cycleView: () => void;

  // Per-pane runtime
  setStatus: (key: string, status: AgentStatus) => void;
  noteActivity: (key: string) => void;
  jumpToAgent: (key: string) => void;

  // Swarm
  toggleSelection: (key: string) => void;
  selectAll: () => void;
  selectNone: () => void;
  setComposerText: (t: string) => void;
  broadcast: () => Promise<number>;

  // Templates
  setTemplatesModalOpen: (open: boolean) => void;
  saveTemplate: (name: string) => string | null;
  loadTemplate: (id: string) => Promise<void>;
  deleteTemplate: (id: string) => void;
  renameTemplate: (id: string, name: string) => void;
  setDefaultTemplate: (id: string | null) => void;

  // Notifications
  toggleNotifications: () => void;

  // Roles
  createRole: (input: Omit<RolePreset, "id">) => string;
  updateRole: (id: string, patch: Partial<Omit<RolePreset, "id">>) => void;
  deleteRole: (id: string) => void;
  assignPaneRole: (paneKey: string, roleId: string | null) => void;
  setRolesModalOpen: (open: boolean) => void;
  setBroadcastOverrideRoleId: (id: string | null) => void;
  setBroadcastPaletteOpen: (open: boolean) => void;

  // Boot
  bootIfNeeded: () => Promise<void>;
}

const STARTER_ROLES: Omit<RolePreset, "id">[] = [
  {
    name: "Reviewer",
    color: "#7c9eff",
    systemPrompt:
      "You are reviewing code in this worktree, not changing it. Read diffs, comment on bugs, security issues, missed edge cases, and unclear naming. Do not run Edit or Write tools. Keep feedback concise and actionable.",
    promptPrefix:
      "Review the pending changes in this worktree against the request below. Focus on bugs, security, and correctness — not style.",
  },
  {
    name: "Tester",
    color: "#5fc37c",
    systemPrompt:
      "You write tests covering the work in this worktree. Read the existing test setup first, follow the project's conventions, and prefer integration tests over heavy mocking. Do not modify production code; only add or extend tests.",
    promptPrefix:
      "Add test coverage for the work in this worktree. If the user message names a target, scope tests to that.",
  },
  {
    name: "Refactorer",
    color: "#d49b56",
    systemPrompt:
      "You refactor code without changing observable behavior. Make small, reviewable diffs. Keep the public API stable. Run tests after each change.",
    promptPrefix:
      "Refactor as described below. Preserve behavior; do not add features.",
  },
  {
    name: "Documenter",
    color: "#b58cff",
    systemPrompt:
      "You write documentation for this codebase. Match the existing voice. Skip obvious comments; explain only what isn't clear from the code.",
    promptPrefix: "Update documentation per the request below.",
  },
];

// Composes the final argv for a `claude` spawn from a pane's user-supplied
// args + its assigned role. Kept pure so TerminalPane can call it at spawn
// time without re-running side effects.
export function composeSpawnArgs(
  userArgs: string[],
  role: RolePreset | undefined,
): string[] {
  if (!role) return userArgs;
  const out = [...userArgs, ...(role.spawnArgs ?? [])];
  if (role.systemPrompt && role.systemPrompt.trim().length > 0) {
    out.push("--append-system-prompt", role.systemPrompt);
  }
  return out;
}

let counter = 0;
const mkKey = () => `pane-${++counter}-${Date.now().toString(36)}`;
const mkTemplateId = () =>
  `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const mkRoleId = () =>
  `role-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Pending "agent idle" notifications, keyed by pane id. Held outside zustand
// because they're imperative side-effects that can be cancelled when status
// changes back. Mid-turn pauses flap thinking→idle→thinking many times; a
// scheduled-and-cancellable notification means only sustained idle fires.
const idleNotifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
const NOTIFY_QUIET_MS = 5000;
const MIN_THINKING_FOR_NOTIFY_MS = 3000;

const cancelIdleNotify = (key: string) => {
  const t = idleNotifyTimers.get(key);
  if (t) {
    clearTimeout(t);
    idleNotifyTimers.delete(key);
  }
};

const VIEW_CYCLE: View[] = ["grid", "radar"];

export const useCrew = create<CrewState>()(
  persist(
    (set, get) => ({
      panes: [],
      focusedKey: null,
      maximizedKey: null,
      view: "grid",
      statuses: {},
      thinkingStartedAt: {},
      lastActivity: {},
      lastBroadcast: {},
      selected: {},
      composerText: "",
      templatesModalOpen: false,
      hasBooted: false,
      branchPicker: null,
      gitPanelOpen: {},
      broadcastOverrideRoleId: null,
      rolesModalOpen: false,
      broadcastPaletteOpen: false,

      templates: [],
      defaultTemplateId: null,
      notificationsEnabled: false,
      roles: [],
      rolesSeeded: false,

      spawnAgent: (cwd, opts = {}) => {
        const key = opts.key ?? mkKey();
        const command = opts.command ?? "claude";
        const args = opts.args ?? [];
        set((s) => ({
          panes: [
            ...s.panes,
            {
              key,
              cwd,
              command,
              args,
              createdAt: Date.now(),
              worktree: opts.worktree,
              roleId: opts.roleId,
            },
          ],
          focusedKey: key,
          statuses: { ...s.statuses, [key]: "spawning" },
          lastActivity: { ...s.lastActivity, [key]: Date.now() },
          selected: { ...s.selected, [key]: true },
        }));
        return key;
      },

      newAgent: async () => {
        const picked = await open({
          directory: true,
          multiple: false,
          title: "Choose folder to launch agent in",
        });
        if (!picked || typeof picked !== "string") return;

        const detect = await gitDetect(picked);
        if (!detect) {
          get().spawnAgent(picked);
          return;
        }

        const launch = await get().openBranchPicker(picked, detect);
        if (!launch) return;

        const { branch: choice, roleId } = launch;

        if (choice.kind === "current") {
          get().spawnAgent(picked, { roleId: roleId ?? undefined });
          return;
        }

        const branchName =
          choice.kind === "existing" ? choice.branch : choice.name;
        const base = choice.kind === "new" ? choice.base : null;
        const newBranch = choice.kind === "new";

        try {
          await get().spawnInWorktree({
            repoRoot: detect.repoRoot,
            branch: branchName,
            base,
            newBranch,
            roleId,
          });
        } catch (e) {
          console.error("worktree creation failed:", e);
          await ask(`Could not create worktree:\n${e}`, {
            title: "Crew",
            kind: "error",
          });
        }
      },

      openBranchPicker: (basePath, detect) =>
        new Promise<LaunchChoice | null>((resolve) => {
          set({ branchPicker: { basePath, detect, resolve } });
        }),

      resolveBranchPicker: (choice) => {
        const req = get().branchPicker;
        if (req) {
          req.resolve(choice);
        }
        set({ branchPicker: null });
      },

      toggleGitPanel: (key) =>
        set((s) => ({
          gitPanelOpen: { ...s.gitPanelOpen, [key]: !s.gitPanelOpen[key] },
        })),

      setGitPanelOpen: (key, open) =>
        set((s) => ({
          gitPanelOpen: { ...s.gitPanelOpen, [key]: open },
        })),

      spawnInWorktree: async ({ repoRoot, branch, base, newBranch, roleId }) => {
        const paneId = mkKey();
        const wt = await gitCreateWorktree({
          repoRoot,
          branch,
          base,
          newBranch,
          paneId,
        });
        get().spawnAgent(wt.worktreePath, {
          key: paneId,
          worktree: {
            repoRoot,
            branch: wt.branch,
            autoCreated: true,
          },
          roleId: roleId ?? undefined,
        });
      },

      closeAgent: async (key) => {
        cancelIdleNotify(key);
        const pane = get().panes.find((p) => p.key === key);
        if (pane?.worktree?.autoCreated) {
          let removed = true;
          try {
            removed = await gitRemoveWorktree(key, false);
          } catch (e) {
            console.error("remove_worktree failed:", e);
          }
          if (!removed) {
            const force = await ask(
              "This worktree has uncommitted changes that will be lost. Continue?",
              { title: "Close worktree", kind: "warning" },
            );
            if (!force) return;
            try {
              await gitRemoveWorktree(key, true);
            } catch (e) {
              console.error("force remove_worktree failed:", e);
              await gitForgetWorktree(key).catch(() => {});
            }
          }
        }
        set((s) => {
          const panes = s.panes.filter((p) => p.key !== key);
          const focusedKey =
            s.focusedKey === key
              ? (panes[panes.length - 1]?.key ?? null)
              : s.focusedKey;
          const maximizedKey = s.maximizedKey === key ? null : s.maximizedKey;
          const statuses = { ...s.statuses };
          delete statuses[key];
          const thinkingStartedAt = { ...s.thinkingStartedAt };
          delete thinkingStartedAt[key];
          const lastActivity = { ...s.lastActivity };
          delete lastActivity[key];
          const lastBroadcast = { ...s.lastBroadcast };
          delete lastBroadcast[key];
          const selected = { ...s.selected };
          delete selected[key];
          const gitPanelOpen = { ...s.gitPanelOpen };
          delete gitPanelOpen[key];
          return {
            panes,
            focusedKey,
            maximizedKey,
            statuses,
            thinkingStartedAt,
            lastActivity,
            lastBroadcast,
            selected,
            gitPanelOpen,
          };
        });
      },

      closeAll: async () => {
        const { panes } = get();
        for (const p of panes) cancelIdleNotify(p.key);
        // Force-cleanup worktrees in parallel — closeAll is a nuclear gesture,
        // we don't prompt per-pane.
        await Promise.allSettled(
          panes
            .filter((p) => p.worktree?.autoCreated)
            .map((p) => gitRemoveWorktree(p.key, true)),
        );
        set({
          panes: [],
          focusedKey: null,
          maximizedKey: null,
          statuses: {},
          thinkingStartedAt: {},
          lastActivity: {},
          lastBroadcast: {},
          selected: {},
          gitPanelOpen: {},
        });
      },

      focus: (key) => set({ focusedKey: key }),

      focusByIndex: (idx) => {
        const { panes } = get();
        if (panes[idx]) set({ focusedKey: panes[idx].key });
      },

      shiftFocus: (delta) => {
        const { panes, focusedKey } = get();
        if (panes.length === 0) return;
        const i = panes.findIndex((p) => p.key === focusedKey);
        const base = i < 0 ? 0 : i;
        const next = (base + delta + panes.length) % panes.length;
        set({ focusedKey: panes[next].key });
      },

      toggleMaximize: (key) => {
        const target = key ?? get().focusedKey;
        if (!target) return;
        set((s) => ({
          maximizedKey: s.maximizedKey === target ? null : target,
          focusedKey: target,
        }));
      },

      setView: (v) => set({ view: v }),

      cycleView: () =>
        set((s) => ({
          view: VIEW_CYCLE[(VIEW_CYCLE.indexOf(s.view) + 1) % VIEW_CYCLE.length],
        })),

      setStatus: (key, status) => {
        const s = get();
        const prev = s.statuses[key];
        if (prev === status) return;

        // Track when the thinking run started so we can suppress
        // notifications for very short flaps (e.g. user typing causes
        // Claude's echo to read as sustained activity for half a second).
        const now = Date.now();
        const nextStarted = { ...s.thinkingStartedAt };
        if (status === "thinking") {
          nextStarted[key] = now;
        }
        const prevStartedAt = s.thinkingStartedAt[key];
        if (prev === "thinking") {
          delete nextStarted[key];
        }

        set({
          statuses: { ...s.statuses, [key]: status },
          thinkingStartedAt: nextStarted,
        });

        // Any status change cancels a pending "idle" notification. If the
        // agent resumed work (thinking) the notification is wrong; if it
        // moved to awaiting/exited/error, the user will see the dot — we
        // don't want to ping for a state that no longer matches.
        cancelIdleNotify(key);

        if (
          s.notificationsEnabled &&
          prev === "thinking" &&
          status === "idle"
        ) {
          const duration =
            prevStartedAt !== undefined ? now - prevStartedAt : Infinity;
          if (duration < MIN_THINKING_FOR_NOTIFY_MS) return;

          // Schedule the notification — only fire if the agent stays idle
          // for NOTIFY_QUIET_MS. Mid-response pauses flap thinking→idle
          // many times per turn; cancellation in the line above ensures
          // only the *final* idle (the one where thinking doesn't resume)
          // actually pings.
          const timer = setTimeout(() => {
            idleNotifyTimers.delete(key);
            const cur = get();
            if (cur.statuses[key] !== "idle") return;
            const pane = cur.panes.find((p) => p.key === key);
            notifyAgentIdle(pane ? labelFromCwd(pane.cwd) : "Agent");
          }, NOTIFY_QUIET_MS);
          idleNotifyTimers.set(key, timer);
        }
      },

      noteActivity: (key) =>
        set((s) => ({
          lastActivity: { ...s.lastActivity, [key]: Date.now() },
        })),

      jumpToAgent: (key) => set({ view: "grid", focusedKey: key }),

      toggleSelection: (key) =>
        set((s) => ({
          selected: { ...s.selected, [key]: !s.selected[key] },
        })),

      selectAll: () =>
        set((s) => ({
          selected: Object.fromEntries(s.panes.map((p) => [p.key, true])),
        })),

      selectNone: () =>
        set((s) => ({
          selected: Object.fromEntries(s.panes.map((p) => [p.key, false])),
        })),

      setComposerText: (t) => set({ composerText: t }),

      broadcast: async () => {
        const {
          panes,
          selected,
          composerText,
          roles,
          broadcastOverrideRoleId,
        } = get();
        const text = composerText;
        if (!text.trim()) return 0;
        const targets = panes.filter((p) => selected[p.key]);
        if (targets.length === 0) return 0;

        // When override is set, every selected pane gets the override role's
        // prefix regardless of its assigned role. Otherwise each pane uses
        // its own assigned role's prefix (or no prefix if unassigned).
        const overrideRole = broadcastOverrideRoleId
          ? roles.find((r) => r.id === broadcastOverrideRoleId)
          : undefined;

        const sentAt = Date.now();
        const sentTexts = new Map<string, string>();

        await Promise.all(
          targets.map((t) => {
            const role = overrideRole
              ? overrideRole
              : t.roleId
                ? roles.find((r) => r.id === t.roleId)
                : undefined;
            const prefix = role?.promptPrefix?.trim();
            const finalText = prefix ? `${prefix}\n\n${text}` : text;
            sentTexts.set(t.key, finalText);
            const bytes = Array.from(
              new TextEncoder().encode(finalText + "\r"),
            );
            return invoke("write_agent", { id: t.key, data: bytes }).catch(
              (e) => {
                console.error("broadcast to", t.key, "failed:", e);
              },
            );
          }),
        );

        set((s) => {
          const lastBroadcast = { ...s.lastBroadcast };
          for (const t of targets) {
            lastBroadcast[t.key] = {
              text: sentTexts.get(t.key) ?? text,
              at: sentAt,
            };
          }
          return { composerText: "", lastBroadcast };
        });
        return targets.length;
      },

      setTemplatesModalOpen: (open) => set({ templatesModalOpen: open }),

      saveTemplate: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return null;
        const { panes } = get();
        if (panes.length === 0) return null;
        const tpl: Template = {
          id: mkTemplateId(),
          name: trimmed,
          createdAt: Date.now(),
          agents: panes.map((p) =>
            p.worktree
              ? {
                  cwd: p.worktree.repoRoot,
                  command: p.command,
                  args: p.args,
                  branch: p.worktree.branch,
                  roleId: p.roleId,
                }
              : {
                  cwd: p.cwd,
                  command: p.command,
                  args: p.args,
                  roleId: p.roleId,
                },
          ),
        };
        set((s) => ({ templates: [...s.templates, tpl] }));
        return tpl.id;
      },

      loadTemplate: async (id) => {
        const { templates, closeAll } = get();
        const tpl = templates.find((t) => t.id === id);
        if (!tpl) return;
        await closeAll();
        // Wait one tick for closeAll's unmounts to complete.
        await new Promise((r) => setTimeout(r, 80));

        // Resolve worktree-bound agents in parallel. This may create
        // worktrees on disk; if that fails for an entry, we surface the
        // error in the console and skip that pane.
        const now = Date.now();
        const built = await Promise.all(
          tpl.agents.map(async (a): Promise<PaneSpec | null> => {
            if (!a.branch) {
              return {
                key: mkKey(),
                cwd: a.cwd,
                command: a.command,
                args: a.args,
                createdAt: now,
                roleId: a.roleId,
              };
            }
            const detect = await gitDetect(a.cwd);
            if (!detect) {
              console.warn(
                `Template branch '${a.branch}' targeted '${a.cwd}' but it is no longer a git repo; skipping.`,
              );
              return null;
            }
            const branches = await gitListBranches(a.cwd);
            const exists = !!branches?.local.some((b) => b.name === a.branch);
            const paneId = mkKey();
            try {
              const wt = await gitCreateWorktree({
                repoRoot: detect.repoRoot,
                branch: a.branch,
                base: exists ? null : detect.currentBranch,
                newBranch: !exists,
                paneId,
              });
              return {
                key: paneId,
                cwd: wt.worktreePath,
                command: a.command,
                args: a.args,
                createdAt: now,
                worktree: {
                  repoRoot: detect.repoRoot,
                  branch: wt.branch,
                  autoCreated: true,
                },
                roleId: a.roleId,
              };
            } catch (e) {
              console.error(
                `Could not load worktree for branch '${a.branch}' from template:`,
                e,
              );
              return null;
            }
          }),
        );
        const newPanes: PaneSpec[] = built.filter(
          (p): p is PaneSpec => p !== null,
        );

        // Add every pane in ONE state update so they all mount in the same
        // React commit — keeps the LCM grid layout from cascading per spawn,
        // which has caused some Claude instances to render at a transient
        // size before settling.
        set({
          panes: newPanes,
          focusedKey: newPanes[0]?.key ?? null,
          maximizedKey: null,
          statuses: Object.fromEntries(
            newPanes.map((p) => [p.key, "spawning" as AgentStatus]),
          ),
          thinkingStartedAt: {},
          lastActivity: Object.fromEntries(
            newPanes.map((p) => [p.key, now]),
          ),
          lastBroadcast: {},
          selected: Object.fromEntries(newPanes.map((p) => [p.key, true])),
        });
      },

      deleteTemplate: (id) => {
        set((s) => ({
          templates: s.templates.filter((t) => t.id !== id),
          defaultTemplateId:
            s.defaultTemplateId === id ? null : s.defaultTemplateId,
        }));
      },

      renameTemplate: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((s) => ({
          templates: s.templates.map((t) =>
            t.id === id ? { ...t, name: trimmed } : t
          ),
        }));
      },

      setDefaultTemplate: (id) =>
        set((s) => ({
          defaultTemplateId:
            id && s.defaultTemplateId === id ? null : id,
        })),

      toggleNotifications: () =>
        set((s) => ({ notificationsEnabled: !s.notificationsEnabled })),

      createRole: (input) => {
        const id = mkRoleId();
        set((s) => ({ roles: [...s.roles, { id, ...input }] }));
        return id;
      },

      updateRole: (id, patch) =>
        set((s) => ({
          roles: s.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),

      deleteRole: (id) =>
        set((s) => {
          // Detach this role from any pane / template / override that
          // referenced it so we don't leave dangling pointers.
          const panes = s.panes.map((p) =>
            p.roleId === id ? { ...p, roleId: undefined } : p,
          );
          const templates = s.templates.map((t) => ({
            ...t,
            agents: t.agents.map((a) =>
              a.roleId === id ? { ...a, roleId: undefined } : a,
            ),
          }));
          return {
            roles: s.roles.filter((r) => r.id !== id),
            panes,
            templates,
            broadcastOverrideRoleId:
              s.broadcastOverrideRoleId === id
                ? null
                : s.broadcastOverrideRoleId,
          };
        }),

      assignPaneRole: (paneKey, roleId) =>
        set((s) => ({
          panes: s.panes.map((p) =>
            p.key === paneKey ? { ...p, roleId: roleId ?? undefined } : p,
          ),
        })),

      setRolesModalOpen: (open) => set({ rolesModalOpen: open }),

      setBroadcastOverrideRoleId: (id) =>
        set({ broadcastOverrideRoleId: id }),

      setBroadcastPaletteOpen: (open) =>
        set({ broadcastPaletteOpen: open }),

      bootIfNeeded: async () => {
        const s = get();
        if (s.hasBooted) return;
        set({ hasBooted: true });
        if (!s.rolesSeeded) {
          // First-run only: ship some sensible roles. If the user wipes them
          // afterwards we won't re-seed, since the flag stays true.
          const seeded = STARTER_ROLES.map((r) => ({ id: mkRoleId(), ...r }));
          set((cur) => ({
            roles: cur.roles.length === 0 ? seeded : cur.roles,
            rolesSeeded: true,
          }));
        }
        if (
          s.panes.length === 0 &&
          s.defaultTemplateId &&
          s.templates.some((t) => t.id === s.defaultTemplateId)
        ) {
          await s.loadTemplate(s.defaultTemplateId);
        }
      },
    }),
    {
      name: "crew.persist.v1",
      version: 1,
      partialize: (state) => ({
        templates: state.templates,
        defaultTemplateId: state.defaultTemplateId,
        notificationsEnabled: state.notificationsEnabled,
        roles: state.roles,
        rolesSeeded: state.rolesSeeded,
      }) as Partial<CrewState>,
    }
  )
);
