import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FastForward, Pause, Play, RotateCcw, SkipForward, Download } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { hhmm, mw, mwh, num, pct } from "../lib/format";
import { Card, Empty, ErrorBox, PageHeader, Pill, Stat } from "../components/ui";
import { SocChart, SupplyChart } from "../components/charts";
import type { DecisionSummary, Run } from "../types/api";

export default function Simulation() {
  const [params, setParams] = useSearchParams();
  const scenarios = useAsync(api.scenarios);
  const versions = useAsync(api.versions);
  const [scenario, setScenario] = useState(params.get("scenario") ?? "compound");
  const [version, setVersion] = useState<number | "">("");
  const [run, setRun] = useState<Run | null>(null);
  const [decisions, setDecisions] = useState<DecisionSummary[]>([]);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedT, setSelectedT] = useState<number | undefined>();
  const timer = useRef<number | null>(null);

  const load = useCallback(async (id: number) => {
    const [r, d] = await Promise.all([api.run(id), api.decisions(id)]);
    setRun(r);
    setDecisions(d.results);
  }, []);

  useEffect(() => {
    const id = Number(params.get("run"));
    if (id) load(id).catch((e) => setError(e.message));
  }, [params, load]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPlaying(false);
    } finally {
      setBusy(false);
    }
  };

  const start = () => guard(async () => {
    const r = await api.createRun(scenario, version || undefined);
    setParams({ run: String(r.id) });
    setRun({ ...r, series: [] });
    setDecisions([]);
    setSelectedT(undefined);
  });

  const advance = useCallback(async (steps: number) => {
    if (!run) return;
    const r = await api.step(run.id, steps);
    setRun((prev) => ({ ...r, series: [...(prev?.series ?? []), ...r.new_decisions.map((d) => d.outcome)] }));
    setDecisions((prev) => [...prev, ...r.new_decisions]);
    if (r.status === "complete") setPlaying(false);
  }, [run]);

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setTimeout(() => { advance(1).catch((e) => { setError(e.message); setPlaying(false); }); }, 350);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [playing, advance, run?.t]);

  const reset = () => guard(async () => {
    if (!run) return;
    setPlaying(false);
    const r = await api.resetRun(run.id);
    setRun({ ...r, series: [] });
    setDecisions([]);
    setSelectedT(undefined);
  });

  const exportSummary = () => {
    if (!run) return;
    const blob = new Blob([JSON.stringify({ run: run.id, scenario: run.scenario, rule_version: run.version, metrics: run.metrics, series: run.series }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gridmind-run-${run.id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const series = run?.series ?? [];
  const last = series[series.length - 1];
  const lastDecision = decisions[decisions.length - 1];
  const selectedDecision = selectedT != null ? decisions.find((d) => d.t === selectedT) : lastDecision;
  const complete = run?.status === "complete";
  const selectedScenario = scenarios.data?.find((s) => s.key === scenario);

  return (
    <div className="space-y-6">
      <PageHeader title="Live Simulation" subtitle="A 24-hour day in 30-minute steps. Each step the agent forecasts, reasons in MeTTa, and commits a plan; the simulator then executes it against actual conditions." />

      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="flex-1">
            <span className="label">Scenario</span>
            <select className="select mt-1 w-full" value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Scenario">
              {(["predefined", "training", "holdout"] as const).map((role) => (
                <optgroup key={role} label={role === "holdout" ? "Held-out (generated)" : role === "training" ? "Training (learning trigger)" : "Predefined"}>
                  {scenarios.data?.filter((s) => s.role === role).map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="lg:w-56">
            <span className="label">Rule version</span>
            <select className="select mt-1 w-full" value={version} onChange={(e) => setVersion(e.target.value ? Number(e.target.value) : "")} aria-label="Rule version">
              <option value="">Active version</option>
              {versions.data?.map((v) => <option key={v.version} value={v.version}>v{v.version} ({v.origin}){v.is_active ? " - active" : ""}</option>)}
            </select>
          </label>
          <button className="btn-primary" onClick={start} disabled={busy}>New run</button>
        </div>
        {selectedScenario && <p className="mt-3 text-xs text-ink-muted">{selectedScenario.description}</p>}
        {run && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <span className="mr-2 text-sm text-ink-2">Run #{run.id} · {run.scenario.name} · rules v{run.version} · step {run.t}/48 ({hhmm(run.t * 0.5)})</span>
            {playing
              ? <button className="btn-ghost" onClick={() => setPlaying(false)}><Pause size={14} /> Pause</button>
              : <button className="btn-ghost" onClick={() => setPlaying(true)} disabled={complete || busy}><Play size={14} /> {run.t ? "Resume" : "Play"}</button>}
            <button className="btn-ghost" onClick={() => guard(() => advance(1))} disabled={complete || busy || playing}><SkipForward size={14} /> Step</button>
            <button className="btn-ghost" onClick={() => guard(() => advance(48))} disabled={complete || busy || playing}><FastForward size={14} /> Run to end</button>
            <button className="btn-ghost" onClick={reset} disabled={busy}><RotateCcw size={14} /> Reset</button>
            <button className="btn-ghost" onClick={exportSummary} disabled={!series.length}><Download size={14} /> Export</button>
            {complete && <Pill status="good">Complete</Pill>}
          </div>
        )}
        {error && <div className="mt-3"><ErrorBox message={error} /></div>}
      </Card>

      {!run ? <Empty>Pick a scenario and start a new run. Try <b>Evening surge + solar shortfall</b> with rules v1 to watch the baseline fail.</Empty> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Demand" value={mw(last?.demand_mw)} />
            <Stat label="Generation" value={mw(last?.generation_mw)} />
            <Stat label="Unserved now" value={mw(last?.unserved_mw)} tone={last && last.unserved_mw > 0 ? "critical" : undefined} />
            <Stat label="Renewable share" value={pct(last?.renewable_share)} />
            <Stat label="Battery" value={pct(last?.soc)} />
            <Stat label="Unserved energy (run)" value={mwh(run.metrics?.unserved_mwh)} tone={run.metrics && run.metrics.unserved_mwh > 0 ? "critical" : "good"} hint={run.metrics ? `score ${num(run.metrics.score)}` : undefined} />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card title="Supply vs demand (MW) - click a step to inspect" className="xl:col-span-2">
              {series.length ? <SupplyChart data={series} onSelect={setSelectedT} selectedT={selectedT} /> : <Empty>Press Play or Step to begin.</Empty>}
              {series.length > 0 && (
                <details className="mt-3 text-xs text-ink-2">
                  <summary className="cursor-pointer text-ink-muted">Data table</summary>
                  <div className="mt-2 max-h-64 overflow-auto">
                    <table className="w-full font-mono">
                      <thead><tr className="text-left text-ink-muted">{["time", "demand", "solar", "wind", "thermal", "battery", "unserved", "SoC"].map((h) => <th key={h} className="pr-3">{h}</th>)}</tr></thead>
                      <tbody>{series.map((o) => (
                        <tr key={o.t}><td className="pr-3">{hhmm(o.hour)}</td><td className="pr-3">{o.demand_mw.toFixed(1)}</td><td className="pr-3">{o.solar_mw.toFixed(1)}</td><td className="pr-3">{o.wind_mw.toFixed(1)}</td><td className="pr-3">{o.thermal_output_mw.toFixed(1)}</td><td className="pr-3">{(o.battery_discharge_mw - o.battery_charge_mw).toFixed(1)}</td><td className="pr-3">{o.unserved_mw.toFixed(1)}</td><td>{(o.soc * 100).toFixed(0)}%</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </details>
              )}
            </Card>
            <Card title={selectedDecision ? `Decision at ${hhmm(selectedDecision.hour)}` : "Decision"}>
              {selectedDecision ? (
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="label mb-1">MeTTa rules fired</div>
                    <div className="flex flex-wrap gap-1">{selectedDecision.fired.length ? selectedDecision.fired.map((f) => <span key={f} className="mono rounded border border-line bg-raised px-1.5 py-0.5">{f}</span>) : <span className="text-ink-muted">none</span>}</div>
                  </div>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <dt className="text-ink-muted">Thermal mode</dt><dd className="mono">{selectedDecision.plan.thermal_mode}</dd>
                    <dt className="text-ink-muted">Commit target</dt><dd className="mono">{mw(selectedDecision.plan.thermal_commit_target_mw)}</dd>
                    <dt className="text-ink-muted">Battery priority</dt><dd className="mono">{selectedDecision.plan.battery_priority}</dd>
                    <dt className="text-ink-muted">Unserved (actual)</dt><dd className={`mono ${selectedDecision.outcome.unserved_mw > 0 ? "text-[#ff8a8a]" : ""}`}>{mw(selectedDecision.outcome.unserved_mw)}</dd>
                  </dl>
                  {selectedDecision.alerts.length > 0 && <div className="flex flex-wrap gap-1">{selectedDecision.alerts.map((a) => <Pill key={a.alert} status="warning">{a.alert}</Pill>)}</div>}
                  <Link to={`/reasoning/${selectedDecision.id}`} className="btn-ghost w-full justify-center">Full reasoning trace →</Link>
                </div>
              ) : <Empty>No decisions yet.</Empty>}
            </Card>
          </div>
          <Card title="Battery state of charge">
            {series.length ? <SocChart data={series} floor={0.1} /> : <Empty>No data yet.</Empty>}
          </Card>
        </>
      )}
    </div>
  );
}
