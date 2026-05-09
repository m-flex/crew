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
  args: string[];
  createdAt: number;
  worktree?: WorktreeMeta;
}

export type BranchChoice =
  | { kind: "current" }
  | { kind: "existing"; branch: string }
  | { kind: "new"; name: string; base: string };

export interface BranchPickerRequest {
  basePath: string;
  detect: DetectInfo;
  resolve: (choice: BranchChoice | null) => void;
}

export interface SpawnOptions {
  command?: string;
  args?: string[];
  key?: string;
  worktree?: WorktreeMeta;
}

export type View = "grid" | "radar" | "swarm";

export interface TemplateAgent {
  cwd: string;
  command: string;
  args: string[];
  // If set, the saved pane was a worktree on this branch. On load, Crew
  // creates a worktree on the branch (creating it if missing). When absent,
  // the agent spawns directly in `cwd` as before.
  branch?: string;
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

  // Persisted
  templates: Template[];
  defaultTemplateId: string | null;
  notificationsEnabled: boolean;

  // Pane lifecycle
  newAgent: () => Promise<void>;
  spawnAgent: (cwd: string, opts?: SpawnOptions) => string;
  closeAgent: (key: string) => Promise<void>;
  closeAll: () => Promise<void>;

  // Branch picker
  openBranchPicker: (
    basePath: string,
    detect: DetectInfo,
  ) => Promise<BranchChoice | null>;
  resolveBranchPicker: (choice: BranchChoice | null) => void;

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

  // Boot
  bootIfNeeded: () => Promise<void>;
}

let counter = 0;
const mkKey = () => `pane-${++counter}-${Date.now().toString(36)}`;
const mkTemplateId = () =>
  `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const VIEW_CYCLE: View[] = ["grid", "radar", "swarm"];

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

      templates: [],
      defaultTemplateId: null,
      notificationsEnabled: false,

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

        const choice = await get().openBranchPicker(picked, detect);
        if (!choice) return;

        if (choice.kind === "current") {
          get().spawnAgent(picked);
          return;
        }

        const branch = choice.kind === "existing" ? choice.branch : choice.name;
        const base = choice.kind === "new" ? choice.base : null;
        const newBranch = choice.kind === "new";

        try {
          await get().spawnInWorktree({
            repoRoot: detect.repoRoot,
            branch,
            base,
            newBranch,
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
        new Promise<BranchChoice | null>((resolve) => {
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

      spawnInWorktree: async ({ repoRoot, branch, base, newBranch }) => {
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
        });
      },

      closeAgent: async (key) => {
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

        const MIN_THINKING_FOR_NOTIFY_MS = 3000;
        if (
          s.notificationsEnabled &&
          prev === "thinking" &&
          status === "idle"
        ) {
          const duration =
            prevStartedAt !== undefined ? now - prevStartedAt : Infinity;
          if (duration >= MIN_THINKING_FOR_NOTIFY_MS) {
            const pane = s.panes.find((p) => p.key === key);
            notifyAgentIdle(pane ? labelFromCwd(pane.cwd) : "Agent");
          }
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
        const { panes, selected, composerText } = get();
        const text = composerText;
        if (!text.trim()) return 0;
        const targets = panes.filter((p) => selected[p.key]);
        if (targets.length === 0) return 0;
        const payload = text + "\r";
        const bytes = Array.from(new TextEncoder().encode(payload));
        const sentAt = Date.now();
        await Promise.all(
          targets.map((t) =>
            invoke("write_agent", { id: t.key, data: bytes }).catch((e) => {
              console.error("broadcast to", t.key, "failed:", e);
            })
          )
        );
        set((s) => {
          const lastBroadcast = { ...s.lastBroadcast };
          for (const t of targets) {
            lastBroadcast[t.key] = { text, at: sentAt };
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
                }
              : { cwd: p.cwd, command: p.command, args: p.args },
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

      bootIfNeeded: async () => {
        const s = get();
        if (s.hasBooted) return;
        set({ hasBooted: true });
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
      }) as Partial<CrewState>,
    }
  )
);
