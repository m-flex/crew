import { useEffect, useState } from "react";
import { useCrew } from "../store";
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

export function RadarView() {
  const panes = useCrew((s) => s.panes);
  const statuses = useCrew((s) => s.statuses);
  const lastActivity = useCrew((s) => s.lastActivity);
  const jumpToAgent = useCrew((s) => s.jumpToAgent);

  // Tick every second so relative-time labels stay live.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (panes.length === 0) return <EmptyState />;

  return (
    <div className="radar">
      <div className="radar-grid">
        {panes.map((spec, i) => {
          const status = statuses[spec.key] ?? "spawning";
          const activity = lastActivity[spec.key] ?? spec.createdAt;
          return (
            <button
              key={spec.key}
              className={`radar-card radar-card-${status}`}
              onClick={() => jumpToAgent(spec.key)}
            >
              <div className="radar-card-top">
                <span className="radar-card-index">{i + 1}</span>
                <span className={`dot dot-${status} dot-lg`} />
              </div>
              <div className="radar-card-body">
                <div className="radar-card-cwd" title={spec.cwd}>
                  {labelFromCwd(spec.cwd)}
                </div>
                <div className="radar-card-status">
                  {STATUS_LABEL[status]}
                </div>
              </div>
              <div className="radar-card-foot">
                <span>{relativeTime(activity)}</span>
              </div>
            </button>
          );
        })}
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

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 2000) return "active now";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
