import { useMemo } from "react";
import { useCrew } from "../store";
import { TerminalPane } from "./TerminalPane";
import { EmptyState } from "./EmptyState";

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

interface PaneLayout {
  row: number;
  span: number;
}

interface GridLayout {
  totalCols: number;
  rows: number;
  byKey: Map<string, PaneLayout>;
}

function computeLayout(keys: string[]): GridLayout {
  const n = keys.length;
  if (n === 0) return { totalCols: 0, rows: 0, byKey: new Map() };
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rowSizes: number[] = [];
  for (let i = 0; i < n; i += cols) {
    rowSizes.push(Math.min(cols, n - i));
  }
  const totalCols = rowSizes.reduce(lcm, 1);
  const byKey = new Map<string, PaneLayout>();
  let cursor = 0;
  rowSizes.forEach((size, r) => {
    const span = totalCols / size;
    for (let c = 0; c < size; c++) {
      byKey.set(keys[cursor++], { row: r, span });
    }
  });
  return { totalCols, rows: rowSizes.length, byKey };
}

interface Props {
  hidden?: boolean;
}

export function AgentGrid({ hidden }: Props) {
  const panes = useCrew((s) => s.panes);
  const focusedKey = useCrew((s) => s.focusedKey);
  const maximizedKey = useCrew((s) => s.maximizedKey);

  const layout = useMemo(
    () => computeLayout(panes.map((p) => p.key)),
    [panes]
  );

  if (panes.length === 0) return <EmptyState />;

  if (maximizedKey && panes.some((p) => p.key === maximizedKey)) {
    // Render every pane (so terminals stay mounted) but show only the
    // maximized one. This keeps PTYs streaming while a single pane fills the
    // grid area.
    return (
      <div
        className="agent-grid agent-grid-maximized"
        style={{ display: hidden ? "none" : "grid" }}
      >
        {panes.map((spec, idx) => {
          const isMax = spec.key === maximizedKey;
          return (
            <div
              key={spec.key}
              className="pane-cell"
              style={{
                display: isMax ? "flex" : "none",
                gridRow: 1,
                gridColumn: 1,
              }}
            >
              <TerminalPane
                spec={spec}
                focused={spec.key === focusedKey}
                index={idx}
              />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className="agent-grid"
      style={{
        display: hidden ? "none" : "grid",
        gridTemplateColumns: `repeat(${layout.totalCols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
      }}
    >
      {panes.map((spec, idx) => {
        const cell = layout.byKey.get(spec.key);
        if (!cell) return null;
        return (
          <div
            key={spec.key}
            className="pane-cell"
            style={{
              gridRow: cell.row + 1,
              gridColumn: `span ${cell.span}`,
            }}
          >
            <TerminalPane
              spec={spec}
              focused={spec.key === focusedKey}
              index={idx}
            />
          </div>
        );
      })}
    </div>
  );
}
