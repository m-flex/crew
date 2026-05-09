export type AgentStatus =
  | "spawning"
  | "thinking"
  | "idle"
  | "awaiting"
  | "exited"
  | "error";

const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;

// Strong "this agent is actively thinking" signal — Claude Code shows
// "(esc to interrupt)" / "esc · interrupt" while a response is being generated.
const THINKING_RE = /esc\s*[·•‧]?\s*(interrupt|stop)/i;

// Confirmation prompt shapes Claude Code uses when asking the user to choose
// (file edits, allowed tools, etc.).
const AWAITING_RE =
  /(Do you want (me )?to|❯ 1\.|^\s*1\.\s+(Yes|Continue|Apply|Allow))/m;

interface DetectorOptions {
  onChange: (status: AgentStatus) => void;
  /** ms of quiet to transition thinking → idle */
  idleDelay?: number;
  /** ms of quiet after a confirmation pattern to transition → awaiting */
  awaitingDelay?: number;
  /** rolling window for "sustained activity" detection */
  activityWindowMs?: number;
  /** number of ingests within the window required to flip to thinking */
  activityThreshold?: number;
}

export interface StatusDetector {
  ingest: (bytes: Uint8Array) => void;
  exit: (code: number | null) => void;
  dispose: () => void;
}

export function createStatusDetector(opts: DetectorOptions): StatusDetector {
  const idleDelay = opts.idleDelay ?? 900;
  const awaitingDelay = opts.awaitingDelay ?? 400;
  const activityWindowMs = opts.activityWindowMs ?? 800;
  const activityThreshold = opts.activityThreshold ?? 2;

  let status: AgentStatus = "spawning";
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ingestTimes: number[] = [];
  let disposed = false;

  const decoder = new TextDecoder("utf-8", { fatal: false });

  const set = (next: AgentStatus) => {
    if (disposed || next === status) return;
    status = next;
    opts.onChange(next);
  };

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    ingest(bytes: Uint8Array) {
      if (disposed) return;
      const stripped = decoder
        .decode(bytes, { stream: true })
        .replace(ANSI_RE, "");
      // Pure ANSI noise (cursor moves, clears) — never enough by itself
      // to call the agent "thinking". Skip the activity bookkeeping.
      if (stripped.replace(/\s/g, "").length === 0) return;

      buffer = (buffer + stripped).slice(-1500);

      const now = Date.now();
      ingestTimes.push(now);
      ingestTimes = ingestTimes.filter((t) => now - t < activityWindowMs);

      const tail = buffer.slice(-600);
      const looksLikeConfirm = AWAITING_RE.test(tail);
      const explicitThinking = THINKING_RE.test(tail);
      const sustained = ingestTimes.length >= activityThreshold;

      // Only flip to thinking on a strong signal: either Claude's own
      // "esc to interrupt" marker, or sustained burst of real output.
      // Single isolated ingests (e.g. SIGWINCH redraws after a view-switch,
      // user keypress echoes) leave status alone.
      if (explicitThinking || sustained) {
        set("thinking");
      } else if (status === "spawning") {
        // First non-trivial bytes after spawn — let the dot settle to idle
        // rather than sticking on "spawning" forever.
        set("idle");
      }

      clearTimer();
      timer = setTimeout(
        () => set(looksLikeConfirm ? "awaiting" : "idle"),
        looksLikeConfirm ? awaitingDelay : idleDelay
      );
    },

    exit(code: number | null) {
      if (disposed) return;
      clearTimer();
      set(code === null || code === 0 ? "exited" : "error");
    },

    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
