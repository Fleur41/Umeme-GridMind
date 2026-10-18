import { Link } from "react-router-dom";
import { ArrowRight, FlaskConical, Play } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { hhmm, mw, mwh, num, pct } from "../lib/format";
import { Card, Empty, ErrorBox, Loading, PageHeader, Pill, Stat } from "../components/ui";
import { SupplyChart } from "../components/charts";

export default function Overview() {
  const { data, error, loading, reload } = useAsync(api.overview);
  const run = useAsync(() => (data?.latest_run ? api.run(data.latest_run.id) : Promise.resolve(null)), [data?.latest_run?.id]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;
  const o = data.latest_decision?.outcome;
  const alerts = data.latest_decision?.alerts ?? [];
  const health = !o ? null : o.unserved_mw > 0 ? "critical" : alerts.length ? "warning" : "good";
  return (
    <div className="space-y-6">
      <PageHeader title="Overview"
        subtitle={<>It doesn't just balance the grid. It learns how to balance it better. A MeTTa rule-based agent dispatches a simulated grid, diagnoses its own failures, and adopts new rules only when they win on held-out scenarios.</>}
        actions={<>
          <Link to="/simulation" className="btn-primary"><Play size={16} aria-hidden /> Start simulation</Link>
          <Link to="/learning" className="btn-ghost"><FlaskConical size={16} aria-hidden /> Learning Lab</Link>
        </>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Grid health" value={health ? <Pill status={health}>{health === "good" ? "Balanced" : health === "warning" ? "Alerts active" : "Unserved demand"}</Pill> : "—"}
          hint={o ? `Run #${data.latest_run?.id}, ${hhmm(o.hour)}` : "No simulation yet"} />
        <Stat label="Active rule version" value={`v${data.active_version}`} hint={`${data.rule_count} MeTTa rules`} />
        <Stat label="Adaptations" value={<span>{data.adaptations.accepted} <span className="text-base text-ink-muted">accepted</span></span>} hint={`${data.adaptations.rejected} rounds rejected`} />
        <Stat label="Renewable share" value={o ? pct(o.renewable_share) : "—"} hint={o ? `Battery ${pct(o.soc)}` : undefined} />
      </div>

      {o && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Generation" value={mw(o.generation_mw)} />
          <Stat label="Demand" value={mw(o.demand_mw)} />
          <Stat label="Imbalance (unserved)" value={mw(o.unserved_mw)} tone={o.unserved_mw > 0 ? "critical" : undefined} />
          <Stat label="Thermal reserve" value={mw(o.thermal_committed_mw - o.thermal_output_mw)} hint="Committed but unused" />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title={data.latest_run ? `Latest run: ${data.latest_run.scenario.name} (rules v${data.latest_run.version})` : "Generation vs demand"} className="xl:col-span-2">
          {run.data?.series?.length ? <SupplyChart data={run.data.series} height={260} /> : <Empty>No simulation has been run yet. <Link className="text-accent underline" to="/simulation">Start one</Link>.</Empty>}
          {run.data?.metrics && (
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-2">
              <span>Unserved: <b className="text-ink">{mwh(run.data.metrics.unserved_mwh)}</b></span>
              <span>Curtailed: <b className="text-ink">{mwh(run.data.metrics.curtailed_mwh)}</b></span>
              <span>Emissions: <b className="text-ink">{num(run.data.metrics.emissions_t)} t</b></span>
              <span>Score: <b className="text-ink">{num(run.data.metrics.score)}</b> (lower is better)</span>
            </div>
          )}
        </Card>
        <Card title="Active alerts">
          {alerts.length ? (
            <ul className="space-y-2">
              {alerts.map((a) => (
                <li key={a.alert} className="flex items-center justify-between gap-2 text-sm">
                  <Pill status={a.alert === "reserve-low" ? "warning" : "info"}>{a.alert}</Pill>
                  <span className="mono text-ink-muted">{a.rule}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>No alerts on the latest step.</Empty>}
          <h3 className="label mb-2 mt-6">Latest learning event</h3>
          {data.latest_adaptation ? (
            <Link to="/learning" className="block rounded-lg border border-line p-3 text-sm hover:bg-raised">
              <div className="flex items-center justify-between">
                <span>v{data.latest_adaptation.from_version} {data.latest_adaptation.to_version ? <>→ v{data.latest_adaptation.to_version}</> : ""}</span>
                <Pill status={data.latest_adaptation.status === "accepted" ? "good" : "neutral"}>{data.latest_adaptation.status}</Pill>
              </div>
              <div className="mono mt-1 text-ink-2">{data.latest_adaptation.accepted_rule?.name ?? `${data.latest_adaptation.candidates.length} candidates rejected`}</div>
            </Link>
          ) : <Empty>The agent has not tried to learn yet.</Empty>}
        </Card>
      </div>

      <Card title="Audit trail" actions={<Link to="/history" className="flex items-center gap-1 text-xs text-accent">Full history <ArrowRight size={12} /></Link>}>
        {data.recent_events.length ? (
          <ul className="divide-y divide-line text-sm">
            {data.recent_events.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-ink-2">{e.message}</span>
                <span className="mono shrink-0 text-ink-muted">{e.kind} · {new Date(e.created_at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        ) : <Empty>No events yet.</Empty>}
      </Card>
    </div>
  );
}
