import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { hhmm, mw } from "../lib/format";
import { Card, Code, Empty, ErrorBox, Loading, PageHeader, Pill } from "../components/ui";
import type { Decision, Fired } from "../types/api";

function Challenge({ decision }: { decision: Decision }) {
  const versions = useAsync(api.versions);
  const [facts, setFacts] = useState<Record<string, string>>({});
  const [version, setVersion] = useState<number>(decision.version);
  const [result, setResult] = useState<{ fired: Fired[]; not_fired: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setFacts(Object.fromEntries(Object.entries(decision.facts).map(([k, v]) => [k, String(v)])));
    setResult(null);
  }, [decision]);
  const run = async () => {
    try {
      setResult(await api.reason(Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, Number(v)])), version));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Card title="Challenge this decision">
      <p className="mb-3 text-xs text-ink-muted">Edit any fact and re-evaluate the rule set in MeTTa. Use this to ask "what if?" or to test a different rule version on the same evidence.</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {Object.keys(facts).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <span className="mono w-40 shrink-0 truncate text-ink-2" title={k}>{k}</span>
            <input className="select w-full py-1 font-mono" type="number" step="any" value={facts[k]} onChange={(e) => setFacts({ ...facts, [k]: e.target.value })} aria-label={k} />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className="select" value={version} onChange={(e) => setVersion(Number(e.target.value))} aria-label="Rule version for challenge">
          {versions.data?.map((v) => <option key={v.version} value={v.version}>rules v{v.version}</option>)}
        </select>
        <button className="btn-primary" onClick={run}>Re-run MeTTa</button>
      </div>
      {error && <div className="mt-3"><ErrorBox message={error} /></div>}
      {result && (
        <div className="mt-3 space-y-1 text-sm">
          {result.fired.map((f) => <div key={f.rule} className="flex items-center gap-2"><CheckCircle2 size={14} className="text-status-good" /><span className="mono">{f.rule}</span><span className="mono text-ink-muted">→ {f.directive}</span></div>)}
          {result.fired.length === 0 && <div className="text-ink-muted">No rule fires for these facts.</div>}
          <div className="text-xs text-ink-muted">Not fired: {result.not_fired.join(", ") || "none"}</div>
        </div>
      )}
    </Card>
  );
}

export default function Reasoning() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [resolvedId, setResolvedId] = useState<number | null>(id ? Number(id) : null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (id) { setResolvedId(Number(id)); return; }
    // Default to the most interesting step of the latest run: its first unserved demand, else its last step.
    api.runs().then(async (runs) => {
      const latest = runs.results.find((r) => r.t > 0);
      if (!latest) { setNotice("No decisions recorded yet. Run a simulation first."); return; }
      const ds = (await api.decisions(latest.id)).results;
      setResolvedId((ds.find((d) => d.outcome.unserved_mw > 0) ?? ds[ds.length - 1]).id);
    }).catch((e) => setNotice(e.message));
  }, [id]);

  const d = useAsync<Decision | null>(() => (resolvedId ? api.decision(resolvedId) : Promise.resolve(null)), [resolvedId]);
  const rules = useAsync(() => (d.data ? api.versions() : Promise.resolve([])), [d.data?.version]);
  const siblings = useAsync(() => (d.data ? api.decisions(d.data.run) : Promise.resolve(null)), [d.data?.run]);

  if (notice) return <><PageHeader title="Agent Reasoning" /><Empty>{notice} <Link to="/simulation" className="text-accent underline">Go to simulation</Link></Empty></>;
  if (d.loading && !d.data) return <Loading />;
  if (d.error) return <ErrorBox message={d.error} onRetry={d.reload} />;
  const x = d.data;
  if (!x) return null;
  const ruleDefs = rules.data?.find((v) => v.version === x.version)?.rules ?? [];
  const o = x.outcome;
  const neighbour = (delta: number) => siblings.data?.results.find((s) => s.t === x.t + delta)?.id;
  const go = (delta: number) => { const n = neighbour(delta); if (n) navigate(`/reasoning/${n}`); };

  return (
    <div className="space-y-6">
      <PageHeader title={`Decision at ${hhmm(x.hour)}`}
        subtitle={<>Run #{x.run} · scenario <span className="mono">{x.scenario}</span> · rules v{x.version} · step {x.t}</>}
        actions={<>
          <button className="btn-ghost" onClick={() => go(-1)} disabled={!neighbour(-1)}><ArrowLeft size={14} /> Previous</button>
          <button className="btn-ghost" onClick={() => go(1)} disabled={!neighbour(1)}>Next <ArrowRight size={14} /></button>
          <Link to={`/simulation?run=${x.run}`} className="btn-ghost">Open run</Link>
        </>} />

      <ol className="grid gap-3 md:grid-cols-5" aria-label="Decision pipeline">
        {["1. Observe (agents)", "2. Facts → MeTTa", "3. Rules fire", "4. Resolve & check", "5. Execute & measure"].map((s) => (
          <li key={s} className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-2">{s}</li>
        ))}
      </ol>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="1. Specialist agent assessments">
          <ul className="space-y-3">
            {x.agents.map((a) => (
              <li key={a.agent} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between"><span className="text-sm font-semibold capitalize">{a.agent} agent</span></div>
                <p className="mt-1 text-sm text-ink-2">{a.recommendation}</p>
                <details className="mt-2"><summary className="cursor-pointer text-xs text-ink-muted">Evidence</summary><Code>{JSON.stringify(a.evidence, null, 2)}</Code></details>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="2. Symbolic facts asserted into the MeTTa space">
          <Code>{x.reasoning.fact_atoms.join("\n")}</Code>
          <p className="mt-2 text-xs text-ink-muted">Facts are added to the Hyperon space for this decision only and retracted afterwards. The agent sees forecasts, not the actual values of the step.</p>
        </Card>
      </div>

      <Card title="3. Rule evaluation (Hyperon runtime: !(decide))">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-ink-muted"><th className="py-2 pr-3 font-medium">Rule</th><th className="pr-3 font-medium">Priority</th><th className="pr-3 font-medium">Condition (MeTTa)</th><th className="pr-3 font-medium">Result</th><th className="font-medium">Resolution</th></tr></thead>
            <tbody className="divide-y divide-line align-top">
              {ruleDefs.map((r) => {
                const fired = x.reasoning.fired.find((f) => f.rule === r.name);
                const res = x.resolution.find((z) => z.rule === r.name);
                return (
                  <tr key={r.name}>
                    <td className="py-2 pr-3"><div className="mono text-ink">{r.name}</div><div className="text-xs text-ink-muted">{r.description}</div></td>
                    <td className="pr-3 font-mono">{r.priority}</td>
                    <td className="mono pr-3 text-ink-2">{r.condition}</td>
                    <td className="pr-3">{fired ? <Pill status="good">fired</Pill> : <Pill status="neutral">not fired</Pill>}</td>
                    <td className="mono text-xs">{fired ? (res ? (res.status === "applied" ? <span className="text-accent">applied {fired.directive}</span> : <span className="text-status-warning">overridden by {res.by}</span>) : <span className="text-ink-2">{fired.directive}</span>) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="4a. Resulting plan">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-ink-muted">Thermal mode</dt><dd className="mono">{x.plan.thermal_mode}</dd>
            <dt className="text-ink-muted">Commit target</dt><dd className="mono">{mw(x.plan.thermal_commit_target_mw)}</dd>
            <dt className="text-ink-muted">Battery priority</dt><dd className="mono">{x.plan.battery_priority}</dd>
            <dt className="text-ink-muted">Battery floor</dt><dd className="mono">{(x.plan.battery_floor * 100).toFixed(0)}%</dd>
            <dt className="text-ink-muted">Charge from surplus</dt><dd className="mono">{String(x.plan.charge_from_surplus)}</dd>
            <dt className="text-ink-muted">Charge from thermal</dt><dd className="mono">{String(x.plan.charge_from_thermal)}</dd>
          </dl>
          {x.alerts.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{x.alerts.map((a) => <Pill key={a.alert} status="warning">{a.alert} ({a.rule})</Pill>)}</div>}
        </Card>
        <Card title="4b. Feasibility checks">
          <ul className="space-y-2 text-sm">
            {x.feasibility.map((f) => (
              <li key={f.check} className="flex gap-2">
                {f.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-status-good" aria-label="passed" /> : <XCircle size={16} className="mt-0.5 shrink-0 text-status-critical" aria-label="limited" />}
                <div><div>{f.check}</div><div className="text-xs text-ink-muted">{f.detail}</div></div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="4c. Rejected alternatives">
          {x.alternatives.length ? (
            <ul className="space-y-2 text-sm">{x.alternatives.map((a) => <li key={a.option}><div>{a.option}{a.target_mw != null ? ` (${mw(a.target_mw)})` : ""}</div><div className="text-xs text-ink-muted">{a.why_not}</div></li>)}</ul>
          ) : <Empty>No alternatives were considered.</Empty>}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="5. Expected vs actual outcome">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-ink-muted"><th className="py-1 font-medium"></th><th className="font-medium">Expected</th><th className="font-medium">Actual</th></tr></thead>
            <tbody className="font-mono">
              <tr><td className="py-1 font-sans text-ink-2">Unserved demand</td><td>{mw(x.expected.unserved_mw)}</td><td className={o.unserved_mw > 0 ? "text-[#ff8a8a]" : ""}>{mw(o.unserved_mw)}</td></tr>
              <tr><td className="py-1 font-sans text-ink-2">Thermal committed</td><td>{mw(x.expected.thermal_committed_mw)}</td><td>{mw(o.thermal_committed_mw)}</td></tr>
              <tr><td className="py-1 font-sans text-ink-2">Demand</td><td>{mw(x.facts.demand)}</td><td>{mw(o.demand_mw)}</td></tr>
              <tr><td className="py-1 font-sans text-ink-2">Battery SoC after</td><td>—</td><td>{(o.soc * 100).toFixed(1)}%</td></tr>
            </tbody>
          </table>
          {o.clipped_actions.length > 0 && (
            <div className="mt-3 text-xs"><div className="label mb-1">Actions limited by physics</div>
              {o.clipped_actions.map((c, i) => <div key={i} className="mono text-ink-2">{c.action}: requested {c.requested_mw} MW, executed {c.executed_mw} MW ({c.reason})</div>)}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-1">
            {Object.entries(o.invariant_checks).map(([k, ok]) => <Pill key={k} status={ok ? "good" : "critical"}>{k.replace(/_/g, " ")}</Pill>)}
          </div>
        </Card>
        <Challenge decision={x} />
      </div>
    </div>
  );
}
