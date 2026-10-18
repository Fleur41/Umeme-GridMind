import { useState } from "react";
import { Save } from "lucide-react";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Card, ErrorBox, Loading, PageHeader, Toast } from "../components/ui";
import { Topology } from "../components/Topology";
import type { GridNode } from "../types/api";

const UNITS: Record<string, string> = {
  capacity_mw: "MW", ramp_mw_per_step: "MW / 30 min", emissions_t_per_mwh: "tCO₂/MWh", spinning_t_per_mw_h: "tCO₂ per MW·h committed",
  energy_capacity_mwh: "MWh", power_mw: "MW", charge_efficiency: "fraction", discharge_efficiency: "fraction",
  soc_min: "fraction", soc_max: "fraction", peak_mw: "MW",
};

function NodeEditor({ node, onSaved }: { node: GridNode; onSaved: (n: GridNode) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(node.params).map(([k, v]) => [k, String(v)])));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      onSaved(await api.updateNode(node.id, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]))));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const keys = Object.keys(node.params);
  return (
    <div className="space-y-3">
      <div>
        <div className="text-base font-semibold">{node.name}</div>
        <div className="text-xs text-ink-muted">{node.kind} · {node.location} · id <span className="mono">{node.id}</span></div>
      </div>
      {keys.length === 0 && <p className="text-sm text-ink-muted">The hub bus has no adjustable parameters.</p>}
      {keys.map((k) => (
        <label key={k} className="block">
          <span className="label">{k.replace(/_/g, " ")} <span className="normal-case tracking-normal text-ink-muted">({UNITS[k] ?? ""})</span></span>
          <input type="number" step="any" min={0} className="select mt-1 w-full font-mono" value={values[k]}
            onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
        </label>
      ))}
      {error && <ErrorBox message={error} />}
      {keys.length > 0 && <button className="btn-primary" onClick={save} disabled={saving}><Save size={14} /> Save parameters</button>}
      <p className="text-xs text-ink-muted">Changes apply to new simulation steps and evaluations. Use Settings → Reset demo to restore defaults.</p>
    </div>
  );
}

export default function TopologyPage() {
  const grid = useAsync(api.grid);
  const runs = useAsync(api.runs);
  const latest = runs.data?.results.find((r) => r.t > 0);
  const run = useAsync(() => (latest ? api.run(latest.id) : Promise.resolve(null)), [latest?.id]);
  const [selected, setSelected] = useState<string>("battery");
  const [toast, setToast] = useState<string | null>(null);
  if (grid.loading && !grid.data) return <Loading />;
  if (grid.error) return <ErrorBox message={grid.error} onRetry={grid.reload} />;
  if (!grid.data) return null;
  const outcome = run.data?.series?.[run.data.series.length - 1];
  const node = grid.data.nodes.find((n) => n.id === selected);
  return (
    <div className="space-y-6">
      <PageHeader title="Grid Topology" subtitle="Illustrative radial network. Leaf buses connect to the central hub through capacity-limited links; flows above capacity are curtailed, never silently exceeded." />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title={outcome ? `Flows at ${run.data?.scenario.name}, step ${outcome.t} (run #${run.data?.id})` : "Static topology (run a simulation to see flows)"} className="xl:col-span-2">
          <Topology nodes={grid.data.nodes} links={grid.data.links} outcome={outcome} selected={selected} onSelect={setSelected} />
          <p className="mt-2 text-xs text-ink-muted">Link labels show flow / capacity in MW. Amber = above 85% loading, red = at capacity. Thermal values show output / committed capacity.</p>
        </Card>
        <Card title="Selected node">
          {node ? <NodeEditor key={node.id} node={node} onSaved={(n) => { grid.setData({ ...grid.data!, nodes: grid.data!.nodes.map((x) => (x.id === n.id ? n : x)) }); setToast(`${n.name} updated`); }} /> : null}
        </Card>
      </div>
      <Card title="Transmission links">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-ink-muted"><th className="py-2 pr-4 font-medium">Link</th><th className="pr-4 font-medium">From → To</th><th className="pr-4 font-medium">Capacity</th><th className="font-medium">Last flow</th></tr></thead>
            <tbody className="divide-y divide-line">
              {grid.data.links.map((l) => (
                <tr key={l.id}><td className="mono py-2 pr-4">{l.id}</td><td className="pr-4 text-ink-2">{l.source} → {l.target}</td><td className="pr-4 font-mono">{l.capacity_mw} MW</td>
                  <td className="font-mono text-ink-2">{outcome?.link_flows_mw[l.id] != null ? `${outcome.link_flows_mw[l.id].toFixed(1)} MW` : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {toast && <Toast kind="good" message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
