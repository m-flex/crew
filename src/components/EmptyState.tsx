import { useCrew } from "../store";

export function EmptyState() {
  const newAgent = useCrew((s) => s.newAgent);
  const setTemplatesModalOpen = useCrew((s) => s.setTemplatesModalOpen);
  const hasTemplates = useCrew((s) => s.templates.length > 0);

  return (
    <div className="empty">
      <div className="empty-card">
        <img className="empty-logo" src="/logo.png" alt="" aria-hidden="true" />
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
