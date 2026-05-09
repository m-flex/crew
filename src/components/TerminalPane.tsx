import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PaneSpec, useCrew } from "../store";
import { TERM_THEME } from "../theme";
import { createStatusDetector, AgentStatus } from "../status";
import "@xterm/xterm/css/xterm.css";

interface PtyOutput {
  agent_id: string;
  data: number[];
}
interface PtyExit {
  agent_id: string;
  code: number | null;
}

interface Props {
  spec: PaneSpec;
  focused: boolean;
  index: number;
}

export function TerminalPane({ spec, focused, index }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  const status = useCrew((s) => s.statuses[spec.key] ?? "spawning");
  const focus = useCrew((s) => s.focus);
  const closeAgent = useCrew((s) => s.closeAgent);
  const setStatus = useCrew((s) => s.setStatus);
  const noteActivity = useCrew((s) => s.noteActivity);
  const isMaximized = useCrew((s) => s.maximizedKey === spec.key);
  const toggleMaximize = useCrew((s) => s.toggleMaximize);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const id = spec.key;

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Cascadia Code", "Consolas", monospace',
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      scrollback: 5000,
      theme: TERM_THEME,
    });
    termRef.current = term;

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    try {
      term.loadAddon(new WebglAddon());
    } catch (e) {
      console.warn("WebGL addon failed", e);
    }

    // Ctrl/Cmd+Click to open URLs in the system browser. Plain click is a
    // no-op so users can still select text that overlaps a link.
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (!event.ctrlKey && !event.metaKey) return;
        openUrl(uri).catch((err) => console.error("openUrl failed", err));
      })
    );

    // Ctrl/Cmd+C copies when there's a selection (otherwise falls through to
    // SIGINT). Ctrl/Cmd+V pastes from the clipboard. Shift+Insert / Ctrl+Insert
    // are also wired for parity with Linux terminals.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "c") {
        const sel = term.getSelection();
        if (sel && sel.length > 0) {
          navigator.clipboard.writeText(sel).catch(console.error);
          term.clearSelection();
          return false;
        }
        return true;
      }
      if (mod && key === "v") {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text) term.paste(text);
          })
          .catch(console.error);
        return false;
      }
      if (mod && e.key === "Insert") {
        const sel = term.getSelection();
        if (sel && sel.length > 0) {
          navigator.clipboard.writeText(sel).catch(console.error);
        }
        return false;
      }
      if (e.shiftKey && e.key === "Insert") {
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text) term.paste(text);
          })
          .catch(console.error);
        return false;
      }
      return true;
    });

    const detector = createStatusDetector({
      onChange: (s: AgentStatus) => setStatus(id, s),
    });

    let unlistenOutput: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;
    let alive = true;
    let spawned = false;

    // ---- Restart watchdog ----
    // If a Claude process never streams any output (hangs on auth, crashes
    // silently, or otherwise gets stuck), tear it down and respawn.
    const STUCK_TIMEOUT_MS = 3_000;
    const MAX_RESTARTS = 2;
    let restartCount = 0;
    let outputReceived = false;
    let stuckTimer: ReturnType<typeof setTimeout> | null = null;

    const clearStuckTimer = () => {
      if (stuckTimer) {
        clearTimeout(stuckTimer);
        stuckTimer = null;
      }
    };
    const armStuckTimer = () => {
      clearStuckTimer();
      stuckTimer = setTimeout(() => {
        stuckTimer = null;
        if (!alive) return;
        // Check live status — Claude sometimes emits ANSI-only setup
        // sequences before its first real character. Those flip
        // `outputReceived` but the detector correctly leaves status at
        // "spawning". Status is the authoritative "did the agent come up?"
        // signal.
        const currentStatus = useCrew.getState().statuses[id];
        if (currentStatus !== "spawning") return;
        triggerRestart("Stuck spawning for 3s");
      }, STUCK_TIMEOUT_MS);
    };

    const triggerRestart = async (reason: string) => {
      if (!alive) return;
      if (restartCount >= MAX_RESTARTS) {
        setStatus(id, "error");
        term.write(
          `\r\n\x1b[31m• ${reason}. Stopped after ${MAX_RESTARTS + 1} attempts.\x1b[0m\r\n`
        );
        return;
      }
      restartCount++;
      term.write(
        `\r\n\x1b[33m• ${reason}. Restarting (${restartCount}/${MAX_RESTARTS})…\x1b[0m\r\n`
      );
      // Tear down the (possibly already-dead) PTY so the id frees up server-side.
      try {
        await invoke("kill_agent", { id });
      } catch {}
      spawned = false;
      outputReceived = false;
      setStatus(id, "spawning");
      // Brief pause so the kill takes effect and any flush settles.
      await new Promise((r) => setTimeout(r, 400));
      if (!alive) return;
      await doSpawn();
    };

    const doSpawn = async () => {
      if (!alive) return;
      try {
        await invoke("spawn_agent", {
          id,
          command: spec.command,
          args: spec.args,
          cwd: spec.cwd,
          cols: term.cols,
          rows: term.rows,
        });
        // Seed last-sent dims so the first ResizeObserver tick is a no-op.
        lastCols = term.cols;
        lastRows = term.rows;
        spawned = true;
        armStuckTimer();
      } catch (err) {
        if (restartCount < MAX_RESTARTS) {
          triggerRestart(`Spawn error: ${String(err)}`);
          return;
        }
        setStatus(id, "error");
        term.write(
          `\r\n\x1b[31mFailed to spawn '${spec.command}': ${String(err)}\x1b[0m\r\n` +
            `\x1b[90mFolder: ${spec.cwd}\x1b[0m\r\n`
        );
      }
    };

    (async () => {
      unlistenOutput = await listen<PtyOutput>("pty-output", (e) => {
        if (e.payload.agent_id !== id) return;
        outputReceived = true;
        // Note: we deliberately do NOT clear the stuck timer here. The timer
        // checks status === "spawning" when it fires; if real content has
        // arrived the detector will have flipped status to thinking/idle and
        // the timer will no-op. ANSI-only setup chatter doesn't change
        // status and therefore shouldn't suppress the restart.
        const bytes = new Uint8Array(e.payload.data);
        detector.ingest(bytes);
        noteActivity(id);
        term.write(bytes);
      });
      unlistenExit = await listen<PtyExit>("pty-exit", (e) => {
        if (e.payload.agent_id !== id) return;
        // If the process died before producing any output, that's a startup
        // failure worth retrying — not a clean exit to surface to the user.
        if (
          spawned &&
          !outputReceived &&
          alive &&
          restartCount < MAX_RESTARTS
        ) {
          triggerRestart("Exited before any output");
          return;
        }
        detector.exit(e.payload.code ?? null);
      });

      if (!alive) return;

      // Wait two animation frames before first fit. One frame after mount
      // is sometimes not enough when several panes commit together (template
      // loads): the grid template is computed in frame 1 but per-cell sizing
      // settles in frame 2.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (!alive) return;
      try {
        fit.fit();
      } catch {}

      await doSpawn();
    })();

    const onData = term.onData((data) => {
      if (!spawned) return;
      const bytes = Array.from(new TextEncoder().encode(data));
      invoke("write_agent", { id, data: bytes }).catch(console.error);
    });

    // Debounce resize_agent calls — every SIGWINCH provokes Claude Code to
    // redraw its banner, and ResizeObserver can fire multiple times during a
    // single layout shift (maximize, OS-window drag, dev HMR). Coalescing to
    // the trailing edge keeps the scrollback clean.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastCols = 0;
    let lastRows = 0;
    const ro = new ResizeObserver(() => {
      // When pane is hidden (display: none) host has 0 size — skip the resize.
      if (host.offsetWidth === 0 || host.offsetHeight === 0) return;
      try {
        fit.fit();
      } catch {}
      if (!spawned) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        if (term.cols === lastCols && term.rows === lastRows) return;
        lastCols = term.cols;
        lastRows = term.rows;
        invoke("resize_agent", {
          id,
          cols: term.cols,
          rows: term.rows,
        }).catch(() => {});
      }, 250);
    });
    ro.observe(host);

    return () => {
      alive = false;
      if (resizeTimer) clearTimeout(resizeTimer);
      clearStuckTimer();
      onData.dispose();
      ro.disconnect();
      unlistenOutput?.();
      unlistenExit?.();
      detector.dispose();
      if (spawned) {
        invoke("kill_agent", { id }).catch(() => {});
      }
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.key]);

  // Refit + re-focus xterm when the pane becomes visible again (view switch).
  useEffect(() => {
    if (!focused) return;
    termRef.current?.focus();
  }, [focused]);

  const cwdLabel = labelFromCwd(spec.cwd);

  return (
    <div
      className={`pane ${focused ? "pane-focused" : ""} pane-status-${status}`}
      onMouseDown={() => focus(spec.key)}
    >
      <div className="pane-header">
        <div className="pane-header-left">
          <span className="pane-index">{index + 1}</span>
          <span className={`dot dot-${status}`} aria-label={status} />
          <span className="pane-cwd" title={spec.cwd}>
            {cwdLabel}
          </span>
        </div>
        <div className="pane-actions">
          <button
            className="pane-action"
            onMouseDown={(e) => {
              e.stopPropagation();
              const bytes = Array.from(new TextEncoder().encode("/clear\r"));
              invoke("write_agent", { id: spec.key, data: bytes }).catch(
                console.error
              );
            }}
            title="Clear conversation (/clear)"
            aria-label="Clear conversation"
          >
            <ClearIcon />
          </button>
          <button
            className="pane-action"
            onMouseDown={(e) => {
              e.stopPropagation();
              toggleMaximize(spec.key);
            }}
            title={isMaximized ? "Restore (Ctrl+M)" : "Maximize (Ctrl+M)"}
            aria-label={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <MaximizeIcon restore />
            ) : (
              <MaximizeIcon />
            )}
          </button>
          <button
            className="pane-close"
            onMouseDown={(e) => {
              e.stopPropagation();
              closeAgent(spec.key);
            }}
            title="Close pane (Ctrl+W)"
            aria-label="Close pane"
          >
            ×
          </button>
        </div>
      </div>
      <div ref={hostRef} className="pane-terminal" />
    </div>
  );
}

function labelFromCwd(cwd: string): string {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return cwd;
  if (parts.length === 1) return parts[0];
  return parts.slice(-2).join("/");
}

function ClearIcon() {
  // Eraser / sweep glyph — diagonal line with a dot, signalling "clear"
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M2 10 L10 2 M2.5 10 H6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface IconProps {
  restore?: boolean;
}
function MaximizeIcon({ restore }: IconProps) {
  if (restore) {
    // Restore (two stacked rectangles)
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
        <path
          d="M3 5 H9 V11 H3 Z M5 3 H11 V9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      </svg>
    );
  }
  // Maximize (single rectangle)
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <rect
        x="2.5"
        y="2.5"
        width="7"
        height="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}
