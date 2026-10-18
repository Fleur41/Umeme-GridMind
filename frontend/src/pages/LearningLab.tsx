import { useEffect, useState } from "react";
import { BrainCircuit, GitCommitHorizontal, Loader2, RotateCcw, Scale } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { change, hhmm, mwh, num, pct } from "../lib/format";
import { Card, Code, Empty, ErrorBox, Loading, PageHeader, Pill, Toast } from "../components/ui";
import { CompareLines, ScoreBars } from "../components/charts";
import type { Adaptation, Comparison, Evaluation, RuleDiff, RuleVersion } from "../types/api";

const STAGES = [
  "Replaying the training scenario with the current rules",
  "Diagnosing failure patterns in MeTTa (diagnosis.metta)",
  "Instantiating candidate rules from templates in MeTTa",
  "Evaluating each candidate on training + 8 held-out scenarios (identical seeds)",
  "Applying the acceptance gate",
];

function Delta({ before, after }: { before: number; after: number }) {
  const c = change(before, after);
  if (Math.abs(c) < 0.0005) return <span className="text-ink-muted">0%</span>;
  return <span className={c < 0 ? "text-accent" : "text-[#ff8a8a]"}>{c < 0 ? "▼" : "▲"} {pct(Math.abs(c), 1)}</span>;
}

function Timeline({ versions, onRollback, busy }: { versions: RuleVersion[]; onRollback: (v: number) => void; busy: boolean }) {
  return (
    <ol className="flex gap-3 overflow-x-auto pb-2" aria-label="Rule version timeline">
      {versions.map((v, i) => {
        const prev = versions[i - 1];
        const added = prev ? v.rules.filter((r) => !prev.rules.some((p) => p.name === r.name)) : [];
        const removed = prev ? prev.rules.filter((r) => !v.rules.some((p) => p.name === r.name)) : [];
        return (
          <li key={v.version} className={`min-w-[220px] flex-1 rounded-xl border p-3 ${v.is_active ? "border-accent/60 bg-accent/5" : "border-line bg-surface"}`}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold"><GitCommitHorizontal size={16} className="text-accent-cyan" />v{v.version}</span>
              {v.is_active ? <Pill status="good">active</Pill> : <Pill status="neutral">{v.origin}</Pill>}
            </div>
            <div className="mt-1 text-xs text-ink-muted">{v.rules.length} rules · {new Date(v.created_at).toLocaleTimeString()}</div>
            {added.map((r) => <div key={r.name} className="mono mt-2 text-accent">+ {r.name}</div>)}
            {removed.map((r) => <div key={r.name} className="mono mt-2 text-[#ff8a8a]">− {r.name}</div>)}
            {!prev && <div className="mt-2 text-xs text-ink-2">Baseline policy</div>}
            {v.holdout_score != null && <div className="mt-2 text-xs text-ink-2">Held-out score <b className="font-mono text-ink">{num(v.holdout_score)}</b></div>}
            {!v.is_active && <button className="btn-ghost mt-3 w-full justify-center py-1 text-xs" onClick={() => onRollback(v.version)} disabled={busy}><RotateCcw size={12} /> Roll back to these rules</button>}
          </li>
        );
      })}
    </ol>
  );
}

function DiffView({ diff }: { diff: RuleDiff }) {
  if (!diff.added.length && !diff.removed.length && !diff.changed.length) return <Empty>No rule changes.</Empty>;
  return (
    <div className="space-y-2">
      <div className="text-xs text-ink-muted">v{diff.from ?? "∅"} → v{diff.to} · {diff.unchanged.length} rules unchanged</div>
      {diff.added.map((r) => (
        <div key={r.name} className="rounded-lg border border-accent/40 bg-accent/5 p-3">
          <div className="mb-1 text-xs font-medium text-accent">+ added: {r.description}</div>
          <pre className="mono whitespace-pre-wrap break-words text-ink">{r.source}</pre>
        </div>
      ))}
      {diff.removed.map((r) => (
        <div key={r.name} className="rounded-lg border border-status-critical/40 bg-status-critical/5 p-3">
          <div className="mb-1 text-xs font-medium text-[#ff8a8a]">− removed</div>
          <pre className="mono whitespace-pre-wrap break-words text-ink-2 line-through decoration-status-critical/60">{r.source}</pre>
        </div>
      ))}
    </div>
  );
}

function Report({ a }: { a: Adaptation }) {
  const base = a.report.baseline;
  const diff = useAsync<RuleDiff | null>(() => (a.to_version ? api.diff(a.to_version, a.from_version) : Promise.resolve(null)), [a.id]);
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Diagnosis: what went wrong (MeTTa patterns)">
          <p className="mb-3 text-xs text-ink-muted">{a.report.diagnosis.episode_count} problem steps from <span className="mono">{a.report.training_scenarios.join(", ")}</span> were asserted as <span className="mono">(ev …)</span> atoms and matched against the patterns in <span className="mono">diagnosis.metta</span>.</p>
          <ul className="space-y-3">
            {a.report.diagnosis.patterns.map((p) => (
              <li key={p.pattern} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2"><span className="mono font-medium">{p.pattern}</span><span className="text-xs text-ink-muted">{p.occurrences} steps</span></div>
                <p className="mt-1 text-sm text-ink-2">{p.description}</p>
                <div className="mt-2 text-xs text-ink-muted">At {p.hours.slice(0, 6).map(hhmm).join(", ")}{p.hours.length > 6 ? "…" : ""}</div>
                <div className="mt-1 text-xs">Remedies: {p.remedies.length ? p.remedies.map((r) => <span key={r} className="mono mr-1 rounded border border-line px-1">{r}</span>) : <span className="text-status-warning">none in the template library (outside the agent's action space)</span>}</div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={a.to_version ? `Rule diff v${a.from_version} → v${a.to_version}` : "Rule diff"}>
          {a.to_version ? (diff.data ? <DiffView diff={diff.data} /> : <Loading />) : <Empty>No rule was accepted in this round, so the rule base is unchanged (v{a.from_version}).</Empty>}
          <div className="mt-4 text-xs text-ink-muted">
            Acceptance gate: held-out score must improve ≥ {pct(a.report.acceptance_criteria.min_holdout_improvement)}, held-out unserved energy must not rise, no held-out scenario may regress more than {pct(a.report.acceptance_criteria.max_scenario_regression)}, zero physical violations, and the training scenario must improve.
          </div>
        </Card>
      </div>
      <Card title={`Candidates evaluated (${a.report.candidates.length}) - round took ${a.duration_s}s`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-ink-muted">
              <th className="py-2 pr-3 font-medium">Candidate rule</th><th className="pr-3 font-medium">Decision</th>
              <th className="pr-3 font-medium">Held-out score</th><th className="pr-3 font-medium">Δ vs v{a.from_version}</th>
              <th className="pr-3 font-medium">Held-out unserved</th><th className="font-medium">Reasons</th>
            </tr></thead>
            <tbody className="divide-y divide-line align-top">
              <tr className="text-ink-2"><td className="py-2 pr-3 italic">current rules (v{a.from_version})</td><td className="pr-3">—</td><td className="pr-3 font-mono">{num(base.holdout.aggregate.score)}</td><td className="pr-3">—</td><td className="pr-3 font-mono">{mwh(base.holdout.aggregate.unserved_mwh)}</td><td /></tr>
              {[...a.report.candidates].sort((x, y) => x.holdout.aggregate.score - y.holdout.aggregate.score).map((c) => (
                <tr key={c.rule.name}>
                  <td className="py-2 pr-3"><div className="mono">{c.rule.name}</div><div className="text-xs text-ink-muted">{c.rule.description}</div></td>
                  <td className="pr-3">{c.status === "accepted" ? <Pill status="good">accepted</Pill> : <Pill status={c.passed ? "neutral" : "critical"}>rejected</Pill>}</td>
                  <td className="pr-3 font-mono">{num(c.holdout.aggregate.score)}</td>
                  <td className="pr-3 font-mono"><Delta before={base.holdout.aggregate.score} after={c.holdout.aggregate.score} /></td>
                  <td className="pr-3 font-mono">{mwh(c.holdout.aggregate.unserved_mwh)}</td>
                  <td className="text-xs text-ink-2"><ul className="list-disc pl-4">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Comparison({ versions, scenarios }: { versions: RuleVersion[]; scenarios: { key: string; name: string; role: string }[] }) {
  const latest = versions.find((v) => v.is_active)?.version ?? 1;
  const [a, setA] = useState(1);
  const [b, setB] = useState(latest);
  const [scenario, setScenario] = useState("holdout-1");
  const [cmp, setCmp] = useState<Comparison | null>(null);
  const [ev, setEv] = useState<Evaluation | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setB(latest), [latest]);
  const go = async (kind: "cmp" | "ev") => {
    setBusy(kind);
    try {
      if (kind === "cmp") setCmp(await api.compare(scenario, a, b));
      else setEv(await api.evaluate(a, b));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const la = `v${cmp?.a.version ?? a}`, lb = `v${cmp?.b.version ?? b}`;
  const rows: [string, keyof Comparison["a"]["metrics"], (v: number) => string][] = [
    ["Unserved energy", "unserved_mwh", (v) => mwh(v)], ["Imbalance duration", "imbalance_hours", (v) => `${v} h`],
    ["Longest imbalance (recovery)", "longest_imbalance_hours", (v) => `${v} h`], ["Renewable curtailment", "curtailed_mwh", (v) => mwh(v)],
    ["Emissions", "emissions_t", (v) => `${num(v)} t`], ["Constraint violations", "violations", (v) => String(v)],
    ["Composite score", "score", (v) => num(v)],
  ];
  return (
    <Card title={<span className="flex items-center gap-2"><Scale size={16} /> Before vs after: identical scenarios, identical seeds</span>}>
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <label><span className="label">Policy A</span><select className="select mt-1 w-full" value={a} onChange={(e) => setA(Number(e.target.value))}>{versions.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}</select></label>
        <label><span className="label">Policy B</span><select className="select mt-1 w-full" value={b} onChange={(e) => setB(Number(e.target.value))}>{versions.map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}</select></label>
        <label className="flex-1"><span className="label">Scenario</span>
          <select className="select mt-1 w-full" value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {scenarios.map((s) => <option key={s.key} value={s.key}>{s.name}{s.role === "holdout" ? " (held-out)" : s.role === "training" ? " (training)" : ""}</option>)}
          </select></label>
        <button className="btn-primary" onClick={() => go("cmp")} disabled={!!busy}>{busy === "cmp" && <Loader2 size={14} className="animate-spin" />} Compare day</button>
        <button className="btn-ghost" onClick={() => go("ev")} disabled={!!busy}>{busy === "ev" && <Loader2 size={14} className="animate-spin" />} Benchmark all held-out</button>
      </div>
      {error && <div className="mt-3"><ErrorBox message={error} /></div>}
      {cmp && (
        <div className="mt-6 grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2 space-y-6">
            <div><h3 className="label mb-2">Unserved demand (MW)</h3><CompareLines a={cmp.a.outcomes} b={cmp.b.outcomes} labelA={la} labelB={lb} field="unserved_mw" unit="MW" /></div>
            <div><h3 className="label mb-2">Battery state of charge (%)</h3><CompareLines a={cmp.a.outcomes} b={cmp.b.outcomes} labelA={la} labelB={lb} field="soc" unit="%" height={180} /></div>
          </div>
          <table className="h-fit w-full text-sm">
            <thead><tr className="text-left text-ink-muted"><th className="py-1 font-medium">Metric</th><th className="font-medium">{la}</th><th className="font-medium">{lb}</th><th className="font-medium">Δ</th></tr></thead>
            <tbody className="divide-y divide-line font-mono">
              {rows.map(([label, key, fmt]) => (
                <tr key={key}><td className="py-1.5 pr-2 font-sans text-ink-2">{label}</td><td className="pr-2">{fmt(cmp.a.metrics[key])}</td><td className="pr-2">{fmt(cmp.b.metrics[key])}</td><td className="text-xs"><Delta before={cmp.a.metrics[key]} after={cmp.b.metrics[key]} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ev && (
        <div className="mt-6">
          <h3 className="label mb-2">Composite score per held-out scenario (lower is better)</h3>
          <ScoreBars labelA={`v${ev.version_a}`} labelB={`v${ev.version_b}`} rows={ev.scenario_keys.map((k) => ({ scenario: k, a: ev.results.a.per_scenario[k].score, b: ev.results.b.per_scenario[k].score }))} />
          <p className="mt-2 text-sm text-ink-2">
            Totals over {ev.scenario_keys.length} held-out scenarios: score {num(ev.results.a.aggregate.score)} → <b className="text-ink">{num(ev.results.b.aggregate.score)}</b> (<Delta before={ev.results.a.aggregate.score} after={ev.results.b.aggregate.score} />), unserved {mwh(ev.results.a.aggregate.unserved_mwh)} → <b className="text-ink">{mwh(ev.results.b.aggregate.unserved_mwh)}</b>, violations {ev.results.a.aggregate.violations} → {ev.results.b.aggregate.violations}.
          </p>
          <p className="mt-1 text-xs text-ink-muted">Score = {Object.entries(ev.results.weights).map(([k, w]) => `${w}×${k}`).join(" + ")}</p>
        </div>
      )}
    </Card>
  );
}

export default function LearningLab() {
  const versions = useAsync(api.versions);
  const adaptations = useAsync(api.adaptations);
  const scenarios = useAsync(api.scenarios);
  const rules = useAsync(api.rules);
  const [selected, setSelected] = useState<number | null>(null);
  const report = useAsync<Adaptation | null>(() => {
    const id = selected ?? adaptations.data?.[0]?.id;
    return id ? api.adaptation(id) : Promise.resolve(null);
  }, [selected, adaptations.data?.[0]?.id]);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(0);
  const [toast, setToast] = useState<{ kind: "good" | "critical"; message: string } | null>(null);

  useEffect(() => {
    if (!running) return;
    setStage(0);
    const id = window.setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 3500);
    return () => window.clearInterval(id);
  }, [running]);

  const refresh = async () => { await Promise.all([versions.reload(), adaptations.reload(), rules.reload()]); };

  const adapt = async () => {
    setRunning(true);
    try {
      const a = await api.adapt();
      setSelected(a.id);
      await refresh();
      setToast(a.status === "accepted"
        ? { kind: "good", message: `Learned ${a.accepted_rule?.name}: v${a.from_version} → v${a.to_version}` }
        : { kind: "critical", message: `All ${a.candidates.length} candidates rejected; rules stay at v${a.from_version}` });
    } catch (e) {
      setToast({ kind: "critical", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  };

  const rollback = async (v: number) => {
    setRunning(true);
    try {
      const nv = await api.rollback(v);
      await refresh();
      setToast({ kind: "good", message: `Rolled back to the rules of v${v} (recorded as v${nv.version})` });
    } catch (e) {
      setToast({ kind: "critical", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  };

  if (versions.loading && !versions.data) return <Loading />;
  if (versions.error) return <ErrorBox message={versions.error} onRetry={versions.reload} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Learning Lab"
        subtitle="The agent replays the compound training day, diagnoses its failures in MeTTa, instantiates candidate rules from a bounded template library, and keeps a rule only if it wins on held-out scenarios it never learned from."
        actions={<button className="btn-primary" onClick={adapt} disabled={running}>{running ? <Loader2 size={16} className="animate-spin" /> : <BrainCircuit size={16} />} Run adaptation round</button>} />

      {running && (
        <Card>
          <ol className="space-y-1 text-sm" aria-live="polite">
            {STAGES.map((s, i) => <li key={s} className={i < stage ? "text-ink-muted line-through" : i === stage ? "text-ink" : "text-ink-muted"}>{i === stage && <Loader2 size={12} className="mr-2 inline animate-spin" />}{s}</li>)}
          </ol>
          <p className="mt-2 text-xs text-ink-muted">Usually 15-30 s. Stage labels advance on a timer while the server works; they are indicative, not streamed progress.</p>
        </Card>
      )}

      <Card title="Growth timeline">
        {versions.data && <Timeline versions={versions.data} onRollback={rollback} busy={running} />}
      </Card>

      <Card title="Adaptation rounds" actions={adaptations.data && adaptations.data.length > 0 ? (
        <select className="select py-1" value={selected ?? adaptations.data[0].id} onChange={(e) => setSelected(Number(e.target.value))} aria-label="Adaptation round">
          {adaptations.data.map((a) => <option key={a.id} value={a.id}>Round #{a.id}: v{a.from_version} {a.to_version ? `→ v${a.to_version}` : "(rejected)"}</option>)}
        </select>) : undefined}>
        {!adaptations.data?.length ? <Empty>No adaptation rounds yet. Run the baseline on the compound scenario, then press <b>Run adaptation round</b>.</Empty>
          : report.data ? <Report a={report.data} /> : <Loading />}
      </Card>

      {versions.data && scenarios.data && <Comparison versions={versions.data} scenarios={scenarios.data} />}

      {rules.data && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Card title={`Active rule base v${rules.data.version.version} (MeTTa)`}>
            <Code>{rules.data.version.rules.map((r) => r.source).join("\n\n")}</Code>
          </Card>
          <Card title="Template library (the agent's bounded growth space)">
            <ul className="mb-3 space-y-1 text-sm">{rules.data.templates.map((t) => <li key={t.template}><span className="mono">{t.template}</span> <span className="text-ink-muted">options: {t.options.join(", ")}</span></li>)}</ul>
            <details><summary className="cursor-pointer text-xs text-ink-muted">templates.metta</summary><Code>{rules.data.metta_sources["templates.metta"]}</Code></details>
            <details className="mt-2"><summary className="cursor-pointer text-xs text-ink-muted">diagnosis.metta</summary><Code>{rules.data.metta_sources["diagnosis.metta"]}</Code></details>
            <details className="mt-2"><summary className="cursor-pointer text-xs text-ink-muted">core.metta</summary><Code>{rules.data.metta_sources["core.metta"]}</Code></details>
          </Card>
        </div>
      )}
      {toast && <Toast kind={toast.kind} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
