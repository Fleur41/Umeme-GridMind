import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { hhmm, mw } from "../lib/format";
import { Card, Empty, ErrorBox, Loading, PageHeader, Pill } from "../components/ui";

export default function HistoryPage() {
  const [offset, setOffset] = useState(0);
  const [alertsOnly, setAlertsOnly] = useState(false);
  const decisions = useAsync(() => api.allDecisions(offset, alertsOnly), [offset, alertsOnly]);
  const audit = useAsync(api.audit);
  return (
    <div className="space-y-6">
      <PageHeader title="Decision History" subtitle="The persistent decision ledger and audit trail. Every step and every rule change is stored and can be inspected." />
      <Card title="Decision ledger" actions={
        <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={alertsOnly} onChange={(e) => { setOffset(0); setAlertsOnly(e.target.checked); }} /> Only steps with alerts</label>}>
        {decisions.error ? <ErrorBox message={decisions.error} onRetry={decisions.reload} /> : !decisions.data ? <Loading /> : !decisions.data.results.length ? <Empty>No decisions recorded yet.</Empty> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-ink-muted">{["Run", "Time", "Rules fired", "Plan", "Unserved", "Alerts", ""].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-line">
                  {decisions.data.results.map((d) => (
                    <tr key={d.id}>
                      <td className="py-2 pr-3 font-mono">#{d.run}</td>
                      <td className="pr-3 font-mono">{hhmm(d.hour)}</td>
                      <td className="mono pr-3 text-ink-2">{d.fired.join(", ") || "—"}</td>
                      <td className="mono pr-3 text-ink-2">{d.plan.thermal_mode}/{d.plan.battery_priority}</td>
                      <td className={`pr-3 font-mono ${d.outcome.unserved_mw > 0 ? "text-[#ff8a8a]" : ""}`}>{mw(d.outcome.unserved_mw)}</td>
                      <td className="pr-3">{d.alerts.map((a) => <Pill key={a.alert} status="warning">{a.alert}</Pill>)}</td>
                      <td><Link to={`/reasoning/${d.id}`} className="text-accent">Inspect</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-ink-muted">
              <span>{offset + 1}-{offset + decisions.data.results.length} of {decisions.data.count}</span>
              <span className="flex gap-2">
                <button className="btn-ghost py-1" onClick={() => setOffset(Math.max(0, offset - 50))} disabled={offset === 0}>Previous</button>
                <button className="btn-ghost py-1" onClick={() => setOffset(offset + 50)} disabled={offset + 50 >= decisions.data.count}>Next</button>
              </span>
            </div>
          </>
        )}
      </Card>
      <Card title="Audit trail">
        {audit.error ? <ErrorBox message={audit.error} /> : !audit.data ? <Loading /> : (
          <ul className="divide-y divide-line text-sm">
            {audit.data.results.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:justify-between">
                <span className="text-ink-2">{e.message}</span>
                <span className="mono shrink-0 text-ink-muted">{e.kind} · {new Date(e.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
