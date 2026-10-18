import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "critical" | "warning" }) {
  const toneClass = tone === "critical" ? "text-status-critical" : tone === "good" ? "text-accent" : tone === "warning" ? "text-status-warning" : "text-ink";
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}

const STATUS = {
  good: { icon: CheckCircle2, cls: "border-status-good/40 bg-status-good/10 text-status-good" },
  warning: { icon: AlertTriangle, cls: "border-status-warning/40 bg-status-warning/10 text-status-warning" },
  critical: { icon: XCircle, cls: "border-status-critical/50 bg-status-critical/10 text-[#ff8a8a]" },
  info: { icon: Info, cls: "border-accent-cyan/40 bg-accent-cyan/10 text-accent-cyan" },
  neutral: { icon: Info, cls: "border-line bg-raised text-ink-2" },
};

export function Pill({ status, children }: { status: keyof typeof STATUS; children: ReactNode }) {
  const { icon: Icon, cls } = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      <Icon size={12} aria-hidden />
      {children}
    </span>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-status-critical/50 bg-status-critical/10 p-3 text-sm text-[#ff9b9b]">
      <span className="flex items-center gap-2"><XCircle size={16} aria-hidden /> {message}</span>
      {onRetry && <button className="btn-ghost" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-ink-muted" role="status">
      <Loader2 className="animate-spin" size={16} aria-hidden /> {label}…
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-muted">{children}</div>;
}

export function Code({ children }: { children: ReactNode }) {
  return <pre className="mono overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-page p-3 text-ink-2">{children}</pre>;
}

export function Toast({ kind, message, onClose }: { kind: "good" | "critical"; message: string; onClose: () => void }) {
  return (
    <div role="status" className="fixed bottom-4 right-4 z-50 max-w-sm">
      <div className={`flex items-start gap-3 rounded-lg border p-3 text-sm shadow-xl ${kind === "good" ? "border-status-good/50 bg-[#0e2a1c] text-ink" : "border-status-critical/50 bg-[#2a1214] text-ink"}`}>
        {kind === "good" ? <CheckCircle2 className="text-status-good" size={18} aria-hidden /> : <XCircle className="text-status-critical" size={18} aria-hidden />}
        <span className="flex-1">{message}</span>
        <button className="text-ink-muted hover:text-ink" onClick={onClose} aria-label="Dismiss">×</button>
      </div>
    </div>
  );
}
