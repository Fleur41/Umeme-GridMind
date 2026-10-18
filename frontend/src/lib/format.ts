export const hhmm = (hour: number) => {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
export const mw = (v: number | undefined, digits = 1) => (v == null ? "—" : `${v.toFixed(digits)} MW`);
export const mwh = (v: number | undefined, digits = 1) => (v == null ? "—" : `${v.toFixed(digits)} MWh`);
export const pct = (v: number | undefined, digits = 0) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);
export const num = (v: number | undefined, digits = 0) =>
  v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const change = (before: number, after: number) => (before === 0 ? 0 : (after - before) / before);
