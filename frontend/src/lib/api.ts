import type {
  Adaptation, AdaptationSummary, AuditEvent, Comparison, Decision, DecisionSummary, Evaluation, GridLink, GridNode,
  Overview, Paged, RuleDiff, RuleVersion, Run, Scenario, Fired,
} from "../types/api";

const BASE = import.meta.env.VITE_API_BASE ?? "/api";
export const TOKEN_KEY = "gridmind.writeToken";

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const t = token();
  if (t) headers["X-GridMind-Token"] = t;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  } catch {
    throw new ApiError("Cannot reach the GridMind API. Is the backend running?", 0);
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, res.status, err?.details);
  }
  return body as T;
}

const post = <T>(path: string, data: unknown = {}) => request<T>(path, { method: "POST", body: JSON.stringify(data) });

export const api = {
  health: () => request<{ status: string; metta: { ok: boolean; result?: string }; seeded: boolean; disclaimer: string }>("/health/"),
  overview: () => request<Overview>("/overview/"),
  grid: () => request<{ nodes: GridNode[]; links: GridLink[] }>("/grid/"),
  updateNode: (id: string, params: Record<string, number>) =>
    request<GridNode>(`/grid/nodes/${id}/`, { method: "PATCH", body: JSON.stringify({ params }) }),
  updateLink: (id: string, capacity_mw: number) =>
    request<GridLink>(`/grid/links/${id}/`, { method: "PATCH", body: JSON.stringify({ capacity_mw }) }),
  scenarios: () => request<Scenario[]>("/scenarios/"),
  runs: () => request<Paged<Run>>("/simulations/?limit=20"),
  run: (id: number) => request<Run>(`/simulations/${id}/`),
  createRun: (scenario: string, version?: number) => post<Run>("/simulations/", { scenario, version }),
  step: (id: number, steps = 1) => post<Run & { new_decisions: DecisionSummary[] }>(`/simulations/${id}/step/`, { steps }),
  resetRun: (id: number) => post<Run>(`/simulations/${id}/reset/`),
  decisions: (run: number) => request<Paged<DecisionSummary>>(`/decisions/?run=${run}&limit=48`),
  allDecisions: (offset = 0, alertsOnly = false) =>
    request<Paged<DecisionSummary>>(`/decisions/?limit=50&offset=${offset}${alertsOnly ? "&alerts=1" : ""}`),
  decision: (id: number) => request<Decision>(`/decisions/${id}/`),
  reason: (facts: Record<string, number>, version?: number) =>
    post<{ fired: Fired[]; not_fired: string[]; fact_atoms: string[] }>("/agent/reason/", { facts, version }),
  rules: () => request<{ version: RuleVersion; templates: { template: string; options: string[] }[]; metta_sources: Record<string, string> }>("/agent/rules/"),
  versions: () => request<RuleVersion[]>("/agent/rules/versions/"),
  diff: (version: number, against?: number) =>
    request<RuleDiff>(`/agent/rules/versions/${version}/diff/${against ? `?against=${against}` : ""}`),
  rollback: (version: number) => post<RuleVersion>(`/agent/rules/versions/${version}/rollback/`),
  adapt: () => post<Adaptation>("/agent/adapt/"),
  adaptations: () => request<AdaptationSummary[]>("/agent/adaptations/"),
  adaptation: (id: number) => request<Adaptation>(`/agent/adaptations/${id}/`),
  compare: (scenario: string, version_a: number, version_b: number) =>
    post<Comparison>("/compare/", { scenario, version_a, version_b }),
  evaluate: (version_a: number, version_b: number) => post<Evaluation>("/evaluations/", { version_a, version_b }),
  audit: () => request<Paged<AuditEvent>>("/audit/?limit=100"),
  resetDemo: () => post<{ ok: boolean; active_version: number }>("/demo/reset/"),
};
