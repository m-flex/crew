import { create } from "zustand";
import { persist } from "zustand/middleware";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { AgentStatus } from "./status";

export interface PaneSpec {
  key: string;
  cwd: string;
  command: string;
  args: string[];
  createdAt: number;
}

export type View = "grid" | "radar" | "swarm";

export interface TemplateAgent {
  cwd: string;
  command: string;
  args: string[];
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
  lastActivity: Record<string, number>;
  lastBroadcast: Record<string, { text: string; at: number }>;
  selected: Record<string, boolean>;
  composerText: string;
  templatesModalOpen: boolean;
  hasBooted: boolean;

  // Persisted
  templates: Template[];
  defaultTemplateId: string | null;

  // Pane lifecycle
  newAgent: () => Promise<void>;
  spawnAgent: (cwd: string, command?: string, args?: string[]) => string;
  closeAgent: (key: string) => void;
  closeAll: () => void;

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
      lastActivity: {},
      lastBroadcast: {},
      selected: {},
      composerText: "",
      templatesModalOpen: false,
      hasBooted: false,

      templates: [],
      defaultTemplateId: null,

      spawnAgent: (cwd, command = "claude", args = []) => {
        const key = mkKey();
        set((s) => ({
          panes: [
            ...s.panes,
            { key, cwd, command, args, createdAt: Date.now() },
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
        get().spawnAgent(picked);
      },

      closeAgent: (key) => {
        set((s) => {
          const panes = s.panes.filter((p) => p.key !== key);
          const focusedKey =
            s.focusedKey === key
              ? (panes[panes.length - 1]?.key ?? null)
              : s.focusedKey;
          const maximizedKey = s.maximizedKey === key ? null : s.maximizedKey;
          const statuses = { ...s.statuses };
          delete statuses[key];
          const lastActivity = { ...s.lastActivity };
          delete lastActivity[key];
          const lastBroadcast = { ...s.lastBroadcast };
          delete lastBroadcast[key];
          const selected = { ...s.selected };
          delete selected[key];
          return {
            panes,
            focusedKey,
            maximizedKey,
            statuses,
            lastActivity,
            lastBroadcast,
            selected,
          };
        });
      },

      closeAll: () => {
        set({
          panes: [],
          focusedKey: null,
          maximizedKey: null,
          statuses: {},
          lastActivity: {},
          lastBroadcast: {},
          selected: {},
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

      setStatus: (key, status) =>
        set((s) =>
          s.statuses[key] === status
            ? s
            : { statuses: { ...s.statuses, [key]: status } }
        ),

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
          agents: panes.map((p) => ({
            cwd: p.cwd,
            command: p.command,
            args: p.args,
          })),
        };
        set((s) => ({ templates: [...s.templates, tpl] }));
        return tpl.id;
      },

      loadTemplate: async (id) => {
        const { templates, closeAll } = get();
        const tpl = templates.find((t) => t.id === id);
        if (!tpl) return;
        closeAll();
        // Wait one tick for closeAll's unmounts to complete.
        await new Promise((r) => setTimeout(r, 80));
        // Add every pane in ONE state update so they all mount in the same
        // React commit. The LCM grid shape resolves once for the final
        // count — no per-spawn layout cascades that have caused some Claude
        // instances to fit at a transient size and render strangely.
        const now = Date.now();
        const newPanes: PaneSpec[] = tpl.agents.map((a) => ({
          key: mkKey(),
          cwd: a.cwd,
          command: a.command,
          args: a.args,
          createdAt: now,
        }));
        set({
          panes: newPanes,
          focusedKey: newPanes[0]?.key ?? null,
          maximizedKey: null,
          statuses: Object.fromEntries(
            newPanes.map((p) => [p.key, "spawning" as AgentStatus])
          ),
          lastActivity: Object.fromEntries(
            newPanes.map((p) => [p.key, now])
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
      }) as Partial<CrewState>,
    }
  )
);
