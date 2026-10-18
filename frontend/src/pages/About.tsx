import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { api, TOKEN_KEY } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Card, ErrorBox, PageHeader, Pill, Toast } from "../components/ui";

function readToken() {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}

export default function About() {
  const health = useAsync(api.health);
  const [token, setToken] = useState(readToken);
  const [toast, setToast] = useState<{ kind: "good" | "critical"; message: string } | null>(null);
  const saveToken = () => {
    try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
    setToast({ kind: "good", message: "Token saved for this browser" });
  };
  const reset = async () => {
    if (!window.confirm("Reset the demo? This deletes all runs, decisions, adaptations and rule versions, and restores baseline v1.")) return;
    try {
      await api.resetDemo();
      setToast({ kind: "good", message: "Demo reset - baseline v1 restored" });
    } catch (e) {
      setToast({ kind: "critical", message: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Settings / About" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="System status">
          {health.error ? <ErrorBox message={health.error} onRetry={health.reload} /> : health.data && (
            <ul className="space-y-2 text-sm">
              <li className="flex justify-between"><span>API</span><Pill status={health.data.status === "ok" ? "good" : "warning"}>{health.data.status}</Pill></li>
              <li className="flex justify-between"><span>MeTTa runtime (Hyperon) probe <span className="mono text-ink-muted">!(+ 1 2)</span></span><Pill status={health.data.metta.ok ? "good" : "critical"}>{health.data.metta.ok ? `returned ${health.data.metta.result}` : "unavailable"}</Pill></li>
              <li className="flex justify-between"><span>Sample data seeded</span><Pill status={health.data.seeded ? "good" : "critical"}>{String(health.data.seeded)}</Pill></li>
            </ul>
          )}
        </Card>
        <Card title="Demo controls">
          <p className="mb-3 text-sm text-ink-2">Restore the sample grid, scenario library and baseline rules so the demonstration can be repeated from the start.</p>
          <button className="btn-ghost" onClick={reset}><RotateCcw size={14} /> Reset demo</button>
          <div className="mt-6">
            <label className="label" htmlFor="token">Write token (only if the server sets GRIDMIND_WRITE_TOKEN)</label>
            <div className="mt-1 flex gap-2">
              <input id="token" type="password" className="select flex-1" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
              <button className="btn-ghost" onClick={saveToken}>Save</button>
            </div>
          </div>
        </Card>
      </div>
      <Card title="About Umeme GridMind">
        <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-ink-2">
          <p><b className="text-ink">Umeme GridMind</b> is a research prototype for the MeTTa Foundation challenge <i>The Agent That Grows Up</i>. A coordinating agent dispatches a simulated grid (solar, wind, a ramp-limited thermal plant, a battery and three load centres) using a small set of rules written in MeTTa and evaluated by the Hyperon runtime at every step.</p>
          <p>After a difficult day, the agent asserts its problem steps into MeTTa, matches them against failure patterns, and instantiates candidate rules from a bounded template library. Each candidate is simulated on the training day and on eight held-out days with identical seeds. A rule is adopted only if it passes an explicit acceptance gate, and every version can be compared, diffed and rolled back.</p>
          <p className="rounded-lg border border-status-warning/40 bg-status-warning/5 p-3 text-ink"><b>Disclaimer.</b> {health.data?.disclaimer ?? "Simulated data only."} This is an educational simulation, not a certified grid controller. It provides no operational advice for real electrical infrastructure and has no connection to any utility, SCADA system or live grid.</p>
        </div>
      </Card>
      {toast && <Toast kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
