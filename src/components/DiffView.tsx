import { useEffect, useState } from "react";
import { DiffFile, DiffResult, gitDiff } from "../git";

interface Props {
  cwd: string;
  path: string;
  staged: boolean;
  onClose: () => void;
}

export function DiffView({ cwd, path, staged, onClose }: Props) {
  const [data, setData] = useState<DiffResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErr(null);
    (async () => {
      try {
        const d = await gitDiff(cwd, path, staged);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd, path, staged]);

  return (
    <div className="diff-view">
      <header className="diff-view-header">
        <button
          className="diff-back"
          onClick={onClose}
          title="Back to status"
        >
          ‹ back
        </button>
        <span className="diff-view-path" title={path}>
          {path}
        </span>
        <span className="diff-view-mode">{staged ? "Staged" : "Working"}</span>
      </header>
      <div className="diff-view-body">
        {err && <div className="branches-error">{err}</div>}
        {!data && !err && (
          <div className="branch-picker-empty">Computing diff…</div>
        )}
        {data && data.files.length === 0 && (
          <div className="branch-picker-empty">No changes.</div>
        )}
        {data?.files.map((f) => <DiffFileBlock key={f.path} file={f} />)}
      </div>
    </div>
  );
}

function DiffFileBlock({ file }: { file: DiffFile }) {
  if (file.isBinary) {
    return (
      <div className="diff-file diff-file-binary">
        <header className="diff-file-header">
          <span>{file.path}</span>
          <span className="muted">binary</span>
        </header>
      </div>
    );
  }
  if (file.hunks.length === 0) {
    return (
      <div className="diff-file">
        <header className="diff-file-header">
          <span>{file.path}</span>
          <span className="muted">
            {file.isNew ? "new" : file.isDeleted ? "deleted" : "no textual changes"}
          </span>
        </header>
      </div>
    );
  }
  return (
    <div className="diff-file">
      {file.hunks.map((h, i) => (
        <div key={i} className="diff-hunk">
          <div className="diff-hunk-header">{h.header.trimEnd()}</div>
          {h.lines.map((l, j) => (
            <div
              key={j}
              className={`diff-line diff-line-${classFor(l.origin)}`}
            >
              <span className="diff-lineno">
                {l.oldLineno !== null ? l.oldLineno : ""}
              </span>
              <span className="diff-lineno">
                {l.newLineno !== null ? l.newLineno : ""}
              </span>
              <span className="diff-glyph">{l.origin === " " ? " " : l.origin}</span>
              <span className="diff-content">{stripNewline(l.content)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function classFor(origin: string): string {
  if (origin === "+") return "add";
  if (origin === "-") return "del";
  if (origin === "<" || origin === ">") return "eofnl";
  return "ctx";
}

function stripNewline(s: string): string {
  if (s.endsWith("\r\n")) return s.slice(0, -2);
  if (s.endsWith("\n")) return s.slice(0, -1);
  return s;
}
