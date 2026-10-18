import { Link } from "react-router-dom";
import { Play } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Card, ErrorBox, Loading, PageHeader, Pill } from "../components/ui";

const ROLE_INFO = {
  predefined: { label: "Predefined", status: "info" as const, text: "Hand-written stress tests for exploring the agent's behaviour." },
  training: { label: "Training", status: "warning" as const, text: "The experience the agent replays and diagnoses when it tries to learn." },
  holdout: { label: "Held-out (generated)", status: "neutral" as const, text: "Randomised variants with fixed seeds. Used only to validate candidate rules - never to trigger learning." },
};

export default function Scenarios() {
  const { data, error, loading, reload } = useAsync(api.scenarios);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Scenario Library" subtitle="Every scenario is a parameter set expanded by a seeded generator, so a scenario always produces exactly the same day." />
      {(["training", "predefined", "holdout"] as const).map((role) => (
        <Card key={role} title={<span className="flex items-center gap-2">{ROLE_INFO[role].label} <Pill status={ROLE_INFO[role].status}>{data?.filter((s) => s.role === role).length}</Pill></span>}>
          <p className="mb-4 text-sm text-ink-2">{ROLE_INFO[role].text}</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data?.filter((s) => s.role === role).map((s) => (
              <div key={s.key} className="flex flex-col rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-2"><span className="font-medium">{s.name}</span><span className="mono text-ink-muted">{s.key}</span></div>
                <p className="mt-1 flex-1 text-sm text-ink-2">{s.description}</p>
                <details className="mt-2"><summary className="cursor-pointer text-xs text-ink-muted">Parameters</summary><pre className="mono mt-1 whitespace-pre-wrap text-ink-2">{JSON.stringify(s.params, null, 1)}</pre></details>
                <Link to={`/simulation?scenario=${s.key}`} className="btn-ghost mt-3 justify-center py-1 text-xs"><Play size={12} /> Simulate</Link>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
