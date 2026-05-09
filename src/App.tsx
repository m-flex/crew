import { useEffect } from "react";
import { useCrew } from "./store";
import { Topbar } from "./components/Topbar";
import { AgentGrid } from "./components/AgentGrid";
import { RadarView } from "./components/RadarView";
import { SwarmView } from "./components/Swarm";
import { TemplatesModal } from "./components/TemplatesModal";
import "./App.css";

function App() {
  const newAgent = useCrew((s) => s.newAgent);
  const closeAgent = useCrew((s) => s.closeAgent);
  const focusedKey = useCrew((s) => s.focusedKey);
  const focusByIndex = useCrew((s) => s.focusByIndex);
  const shiftFocus = useCrew((s) => s.shiftFocus);
  const view = useCrew((s) => s.view);
  const cycleView = useCrew((s) => s.cycleView);
  const toggleMaximize = useCrew((s) => s.toggleMaximize);
  const bootIfNeeded = useCrew((s) => s.bootIfNeeded);

  useEffect(() => {
    bootIfNeeded();
  }, [bootIfNeeded]);

  useEffect(() => {
    // Capture phase + stopPropagation so xterm's textarea listener never sees
    // these — otherwise typing into a focused Claude session swallows shortcuts.
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      let handled = false;
      if (e.key === "t" || e.key === "T") {
        newAgent();
        handled = true;
      } else if (e.key === "w" || e.key === "W") {
        if (focusedKey) closeAgent(focusedKey);
        handled = true;
      } else if (e.key === "m" || e.key === "M") {
        toggleMaximize();
        handled = true;
      } else if (e.key >= "1" && e.key <= "9") {
        focusByIndex(parseInt(e.key, 10) - 1);
        handled = true;
      } else if (e.key === "]") {
        shiftFocus(1);
        handled = true;
      } else if (e.key === "[") {
        shiftFocus(-1);
        handled = true;
      } else if (e.key === "\\") {
        cycleView();
        handled = true;
      }

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    newAgent,
    closeAgent,
    focusByIndex,
    shiftFocus,
    focusedKey,
    cycleView,
    toggleMaximize,
  ]);

  return (
    <div className="app">
      <Topbar />
      <div className="views">
        <AgentGrid hidden={view !== "grid"} />
        {view === "radar" && <RadarView />}
        {view === "swarm" && <SwarmView />}
      </div>
      <TemplatesModal />
    </div>
  );
}

export default App;
