import type { GridLink, GridNode, Outcome } from "../types/api";
import { COLORS } from "./charts";

const POS: Record<string, [number, number]> = {
  hub: [300, 190], solar: [90, 70], wind: [300, 70], thermal: [90, 310], battery: [300, 345],
  city: [520, 70], industry: [540, 200], homes: [520, 320],
};
const KIND_COLOR: Record<string, string> = {
  solar: COLORS.solar, wind: COLORS.wind, thermal: COLORS.thermal, battery: COLORS.battery,
  load: "#c3c2b7", hub: "#3fd0e8",
};

function nodeValue(n: GridNode, o?: Outcome): string | null {
  if (!o) return null;
  switch (n.kind) {
    case "solar": return `${o.solar_mw.toFixed(0)} MW`;
    case "wind": return `${o.wind_mw.toFixed(0)} MW`;
    case "thermal": return o.thermal_available ? `${o.thermal_output_mw.toFixed(0)}/${o.thermal_committed_mw.toFixed(0)} MW` : "OFFLINE";
    case "battery": return `${(o.soc * 100).toFixed(0)}%`;
    case "load": return o.link_flows_mw[`L-${n.id}`] != null ? `${o.link_flows_mw[`L-${n.id}`].toFixed(0)} MW` : null;
    default: return null;
  }
}

export function Topology({ nodes, links, outcome, selected, onSelect }: {
  nodes: GridNode[]; links: GridLink[]; outcome?: Outcome; selected?: string; onSelect?: (id: string) => void;
}) {
  const place = (id: string, i: number): [number, number] => POS[id] ?? [80 + (i % 5) * 110, 380];
  // Battery and thermal sit at the hub bus; draw their connection as a short local tie.
  const ties = nodes.filter((n) => n.kind === "battery" || n.kind === "thermal").map((n) => ({ id: `tie-${n.id}`, source: n.id, target: "hub" }));
  return (
    <svg viewBox="0 0 640 390" className="h-auto w-full" role="img" aria-label="Grid topology: radial network around the central hub">
      {[...links.map((l) => ({ ...l, tie: false })), ...ties.map((t) => ({ ...t, capacity_mw: 0, tie: true }))].map((l, i) => {
        const a = place(l.source, i), b = place(l.target, i);
        const flow = outcome?.link_flows_mw[l.id];
        const cap = outcome?.link_capacity_mw[l.id] ?? l.capacity_mw;
        const loading = flow != null && cap ? flow / cap : 0;
        const stroke = l.tie ? "#2c3a55" : loading >= 0.999 ? COLORS.unserved : loading > 0.85 ? "#fab219" : "#3fd0e8";
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        return (
          <g key={l.id}>
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={stroke} strokeOpacity={l.tie ? 1 : 0.35 + 0.65 * Math.min(1, loading)} strokeWidth={l.tie ? 2 : 3} strokeDasharray={l.tie ? "4 4" : undefined} />
            {!l.tie && (
              <g>
                <rect x={mx - 40} y={my - 10} width={80} height={20} rx={6} fill="#0a101c" stroke="#22304a" />
                <text x={mx} y={my + 4} textAnchor="middle" fontSize={10} fill="#c3c2b7" fontFamily="JetBrains Mono, monospace">
                  {flow != null ? `${flow.toFixed(0)}/${cap.toFixed(0)}` : `cap ${cap.toFixed(0)}`} MW
                </text>
              </g>
            )}
          </g>
        );
      })}
      {nodes.map((n, i) => {
        const [x, y] = place(n.id, i);
        const value = nodeValue(n, outcome);
        const isSel = selected === n.id;
        // Nodes directly above the hub get their label above, so it does not sit on the link.
        const labelY = Math.abs(x - 300) < 20 && y < 120 ? -40 : n.kind === "hub" ? 36 : 32;
        return (
          <g key={n.id} transform={`translate(${x},${y})`} className="cursor-pointer" onClick={() => onSelect?.(n.id)}
            role="button" tabIndex={0} aria-label={`${n.name}${value ? `: ${value}` : ""}`}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect?.(n.id)}>
            <circle r={n.kind === "hub" ? 20 : 16} fill="#0f1726" stroke={KIND_COLOR[n.kind]} strokeWidth={isSel ? 4 : 2} />
            <circle r={5} fill={KIND_COLOR[n.kind]} />
            <text y={labelY} textAnchor="middle" fontSize={11} fill="#f0efec" fontWeight={500}>{n.name}</text>
            {value && <text y={labelY + 14} textAnchor="middle" fontSize={10} fill={value === "OFFLINE" ? "#ff8a8a" : "#c3c2b7"} fontFamily="JetBrains Mono, monospace">{value}</text>}
          </g>
        );
      })}
    </svg>
  );
}
