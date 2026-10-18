import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Activity, BookOpen, BrainCircuit, FlaskConical, History, LayoutDashboard, Library, Menu, Network, Settings, X, Zap } from "lucide-react";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/topology", label: "Grid Topology", icon: Network },
  { to: "/simulation", label: "Live Simulation", icon: Activity },
  { to: "/reasoning", label: "Agent Reasoning", icon: BrainCircuit },
  { to: "/learning", label: "Learning Lab", icon: FlaskConical },
  { to: "/scenarios", label: "Scenario Library", icon: Library },
  { to: "/history", label: "Decision History", icon: History },
  { to: "/about", label: "Settings / About", icon: Settings },
];

export function Layout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end={to === "/"} onClick={() => setOpen(false)}
          className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? "bg-raised text-ink" : "text-ink-2 hover:bg-raised/60 hover:text-ink"}`}>
          {({ isActive }) => (<><Icon size={16} className={isActive ? "text-accent" : ""} aria-hidden />{label}</>)}
        </NavLink>
      ))}
    </nav>
  );
  const brand = (
    <div className="flex items-center gap-2">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent"><Zap size={18} aria-hidden /></span>
      <div>
        <div className="text-sm font-semibold leading-tight text-ink">Umeme GridMind</div>
        <div className="text-[11px] leading-tight text-ink-muted">Adaptive Energy Intelligence</div>
      </div>
    </div>
  );
  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface p-4 lg:flex lg:sticky lg:top-0 lg:h-screen">
        {brand}
        {nav}
        <div className="mt-auto rounded-lg border border-line p-3 text-[11px] leading-relaxed text-ink-muted">
          <BookOpen size={12} className="mb-1 inline" aria-hidden /> Research prototype. All grid data is <strong className="text-ink-2">simulated</strong>; not connected to any utility or real infrastructure.
        </div>
      </aside>
      <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        {brand}
        <button className="btn-ghost" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Toggle navigation">
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>
      {open && <div className="border-b border-line bg-surface p-3 lg:hidden">{nav}</div>}
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent-cyan/30 bg-accent-cyan/5 px-3 py-1 text-[11px] font-medium text-accent-cyan">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-cyan" aria-hidden /> SIMULATED DATA MODE
        </div>
        {children}
      </main>
    </div>
  );
}
