import { useCrew } from "../store";

export function EmptyState() {
  const newAgent = useCrew((s) => s.newAgent);
  const setTemplatesModalOpen = useCrew((s) => s.setTemplatesModalOpen);
  const hasTemplates = useCrew((s) => s.templates.length > 0);

  return (
    <div className="empty">
      <div className="empty-card">
        <svg
          className="empty-logo"
          viewBox="0 0 64 64"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="10"
            y="14"
            width="34"
            height="26"
            rx="4"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity="0.45"
          />
          <rect
            x="20"
            y="24"
            width="34"
            height="26"
            rx="4"
            fill="rgba(74, 144, 226, 0.08)"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="28" cy="34" r="2" fill="currentColor" />
          <path
            d="M34 38h12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.6"
          />
          <path
            d="M28 42h18"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.4"
          />
        </svg>
        <h1 className="empty-title">No agents running</h1>
        <p className="empty-hint">
          Pick a folder. Crew launches a Claude session there. Spin up as many
          as you need; each one keeps to its own working directory.
        </p>
        <button className="empty-cta" onClick={() => newAgent()}>
          <span className="action-plus">+</span>
          <span>Launch first agent</span>
          <kbd className="kbd">⌃T</kbd>
        </button>
        {hasTemplates && (
          <button
            className="empty-secondary"
            onClick={() => setTemplatesModalOpen(true)}
          >
            or load a template…
          </button>
        )}
      </div>
    </div>
  );
}
