import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Outcome } from "../types/api";
import { hhmm } from "../lib/format";

export const COLORS = {
  solar: "#c98500", wind: "#3987e5", thermal: "#d95926", battery: "#199e70",
  demand: "#f0efec", unserved: "#d03b3b", baseline: "#8c8a84", adapted: "#3987e5",
  grid: "#1d2940", axis: "#2c3a55", muted: "#8c8a84",
};

const axisProps = { stroke: COLORS.axis, tick: { fill: COLORS.muted, fontSize: 11 }, tickLine: false };

type Row = Record<string, number | string>;

function TooltipBox({ active, payload, label, unit = "MW" }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: number; unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-raised/95 px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-ink">{typeof label === "number" ? hhmm(label) : label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4 text-ink-2">
          <span className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}</span>
          <span className="font-mono text-ink">{typeof p.value === "number" ? p.value.toFixed(unit === "%" ? 0 : 1) : p.value} {unit}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-4" style={{ borderTop: `2px ${i.dashed ? "dashed" : "solid"} ${i.color}` }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Supply stack (delivered MW by source) against demand, with unserved demand. */
export function SupplyChart({ data, height = 300, onSelect, selectedT }: { data: Outcome[]; height?: number; onSelect?: (t: number) => void; selectedT?: number }) {
  const rows: Row[] = data.map((o) => {
    // Surplus curtailment is shared between solar and wind in proportion to what each delivered to the hub.
    const delivered = o.solar_mw + o.wind_mw;
    const keep = delivered > 0 ? o.renewable_mw / delivered : 0;
    return {
      hour: o.hour, t: o.t, Solar: o.solar_mw * keep, Wind: o.wind_mw * keep, Thermal: o.thermal_output_mw,
      Battery: o.battery_discharge_mw, Demand: o.demand_mw, Unserved: o.unserved_mw,
    };
  });
  return (
    <div>
      <Legend items={[
        { label: "Solar", color: COLORS.solar }, { label: "Wind", color: COLORS.wind },
        { label: "Thermal", color: COLORS.thermal }, { label: "Battery discharge", color: COLORS.battery },
        { label: "Demand", color: COLORS.demand, dashed: true }, { label: "Unserved demand", color: COLORS.unserved },
      ]} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}
          onClick={(e) => { const t = (e?.activePayload?.[0]?.payload as Row | undefined)?.t; if (onSelect && typeof t === "number") onSelect(t); }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="hour" type="number" domain={[0, 24]} ticks={[0, 4, 8, 12, 16, 20, 24]} tickFormatter={hhmm} {...axisProps} />
          <YAxis {...axisProps} width={44} unit="" />
          <Tooltip content={<TooltipBox />} cursor={{ stroke: COLORS.muted, strokeDasharray: "3 3" }} />
          {(["Solar", "Wind", "Thermal", "Battery"] as const).map((k) => (
            <Area key={k} type="stepAfter" dataKey={k} stackId="s" isAnimationActive={false}
              stroke={COLORS[k.toLowerCase() as keyof typeof COLORS]} strokeWidth={1.5}
              fill={COLORS[k.toLowerCase() as keyof typeof COLORS]} fillOpacity={0.35} />
          ))}
          <Bar dataKey="Unserved" fill={COLORS.unserved} barSize={6} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="Demand" stroke={COLORS.demand} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
          {selectedT != null && <ReferenceLine x={selectedT * 0.5} stroke={COLORS.demand} strokeOpacity={0.5} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SocChart({ data, height = 160, floor }: { data: { hour: number; soc: number }[]; height?: number; floor?: number }) {
  const rows = data.map((d) => ({ hour: d.hour, "State of charge": Math.round(d.soc * 1000) / 10 }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid stroke={COLORS.grid} vertical={false} />
        <XAxis dataKey="hour" type="number" domain={[0, 24]} ticks={[0, 6, 12, 18, 24]} tickFormatter={hhmm} {...axisProps} />
        <YAxis domain={[0, 100]} unit="%" {...axisProps} width={44} />
        <Tooltip content={<TooltipBox unit="%" />} />
        {floor != null && <ReferenceLine y={floor * 100} stroke={COLORS.unserved} strokeDasharray="4 4" label={{ value: "min SoC", fill: COLORS.muted, fontSize: 10, position: "insideBottomRight" }} />}
        <Line type="monotone" dataKey="State of charge" stroke={COLORS.battery} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Same scenario, two policies: one measure at a time (never dual-axis). */
export function CompareLines({ a, b, labelA, labelB, field, unit, height = 220 }: {
  a: Outcome[]; b: Outcome[]; labelA: string; labelB: string; field: keyof Outcome; unit: string; height?: number;
}) {
  const scale = unit === "%" ? 100 : 1;
  const rows = a.map((o, i) => ({ hour: o.hour, [labelA]: (o[field] as number) * scale, [labelB]: ((b[i]?.[field] as number) ?? 0) * scale }));
  return (
    <div>
      <Legend items={[{ label: labelA, color: COLORS.baseline, dashed: true }, { label: labelB, color: COLORS.adapted }]} />
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="hour" type="number" domain={[0, 24]} ticks={[0, 6, 12, 18, 24]} tickFormatter={hhmm} {...axisProps} />
          <YAxis {...axisProps} width={44} />
          <Tooltip content={<TooltipBox unit={unit} />} />
          <Line type="stepAfter" dataKey={labelA} stroke={COLORS.baseline} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
          <Line type="stepAfter" dataKey={labelB} stroke={COLORS.adapted} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ScoreBars({ rows, labelA, labelB, height = 260 }: { rows: { scenario: string; a: number; b: number }[]; labelA: string; labelB: string; height?: number }) {
  const data = rows.map((r) => ({ scenario: r.scenario.replace("holdout-", "H"), [labelA]: r.a, [labelB]: r.b }));
  return (
    <div>
      <Legend items={[{ label: labelA, color: COLORS.baseline }, { label: labelB, color: COLORS.adapted }]} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="scenario" {...axisProps} />
          <YAxis {...axisProps} width={52} />
          <Tooltip content={<TooltipBox unit="pts" />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey={labelA} fill={COLORS.baseline} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey={labelB} fill={COLORS.adapted} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
