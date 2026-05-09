import { useEffect, useRef, useState } from "react";
import { useCrew, PaneSpec } from "../store";
import { AgentStatus } from "../status";
import { EmptyState } from "./EmptyState";

const STATUS_LABEL: Record<AgentStatus, string> = {
  spawning: "Spawning",
  thinking: "Thinking",
  idle: "Idle",
  awaiting: "Awaiting input",
  exited: "Exited",
  error: "Error",
};

export function SwarmView() {
  const panes = useCrew((s) => s.panes);
  const composerText = useCrew((s) => s.composerText);
  const setComposerText = useCrew((s) => s.setComposerText);
  const selectAll = useCrew((s) => s.selectAll);
  const selectNone = useCrew((s) => s.selectNone);
  const broadcast = useCrew((s) => s.broadcast);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const now = useTick(5_000);

  const selectedCount = useCrew(
    (s) => s.panes.filter((p) => s.selected[p.key]).length
  );

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, [composerText]);

  if (panes.length === 0) return <EmptyState />;

  const canSend = composerText.trim().length > 0 && selectedCount > 0;

  const send = async () => {
    if (!canSend) return;
    await broadcast();
  };

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="swarm">
      <div className="composer">
        <textarea
          ref={taRef}
          className="composer-input"
          placeholder="Broadcast a prompt to selected agents — Ctrl+Enter to send"
          value={composerText}
          onChange={(e) => setComposerText(e.target.value)}
          onKeyDown={onComposerKey}
          rows={3}
          spellCheck={false}
          autoFocus
        />
        <div className="composer-actions">
          <div className="composer-selection">
            <span className="composer-selection-count">
              <span className="muted">Selected:</span>{" "}
              <span className="emphasis">{selectedCount}</span>{" "}
              <span className="muted">of {panes.length}</span>
            </span>
            <button className="link-btn" onClick={selectAll}>
              All
            </button>
            <span className="dot-sep">·</span>
            <button className="link-btn" onClick={selectNone}>
              None
            </button>
          </div>
          <button className="primary-btn" onClick={send} disabled={!canSend}>
            <span>Send to {selectedCount}</span>
            <kbd className="kbd kbd-on-primary">⌃↵</kbd>
          </button>
        </div>
      </div>

      <div className="swarm-cards">
        {panes.map((spec, i) => (
          <SwarmCard key={spec.key} spec={spec} index={i} now={now} />
        ))}
      </div>
    </div>
  );
}

interface CardProps {
  spec: PaneSpec;
  index: number;
  now: number;
}

const SwarmCard = ({ spec, index, now }: CardProps) => {
  const status = useCrew((s) => s.statuses[spec.key] ?? "spawning");
  const isSelected = useCrew((s) => !!s.selected[spec.key]);
  const lastActivity = useCrew((s) => s.lastActivity[spec.key]);
  const lastBroadcast = useCrew((s) => s.lastBroadcast[spec.key]);
  const toggleSelection = useCrew((s) => s.toggleSelection);
  const jumpToAgent = useCrew((s) => s.jumpToAgent);

  const statusTime = activityLabel(status, lastActivity, now);

  return (
    <div
      className={
        `swarm-card swarm-card-${status} ` +
        (isSelected ? "swarm-card-selected" : "swarm-card-deselected")
      }
    >
      <div className="swarm-card-head">
        <label className="swarm-check" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelection(spec.key)}
          />
          <span className="swarm-check-mark" aria-hidden />
        </label>
        <span className="pane-index">{index + 1}</span>
        <span className={`dot dot-${status}`} aria-label={status} />
        <button
          className="swarm-card-cwd"
          title={spec.cwd}
          onClick={() => jumpToAgent(spec.key)}
        >
          {labelFromCwd(spec.cwd)}
        </button>
        <span className="swarm-card-status">
          {STATUS_LABEL[status]}
          {statusTime ? <span className="swarm-card-status-time"> · {statusTime}</span> : null}
        </span>
      </div>

      {lastBroadcast ? (
        <div className="swarm-card-broadcast" title={lastBroadcast.text}>
          <span className="swarm-card-broadcast-meta">
            Sent {relativeTime(lastBroadcast.at, now)}
          </span>
          <span className="swarm-card-broadcast-text">
            {oneLine(lastBroadcast.text)}
          </span>
        </div>
      ) : null}
    </div>
  );
};

function labelFromCwd(cwd: string): string {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return cwd;
  if (parts.length === 1) return parts[0];
  return parts.slice(-2).join("/");
}

function activityLabel(
  status: AgentStatus,
  lastActivity: number | undefined,
  now: number
): string {
  if (status === "awaiting" || status === "exited" || status === "error") return "";
  if (!lastActivity) return "";
  return relativeTime(lastActivity, now);
}

function relativeTime(then: number, now: number): string {
  const ms = Math.max(0, now - then);
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
