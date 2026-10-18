export interface Rule {
  name: string;
  priority: number;
  condition: string;
  directive: string;
  description: string;
  source: string;
}

export interface RuleVersion {
  id: number;
  version: number;
  rules: Rule[];
  parent: number | null;
  origin: "baseline" | "adaptation" | "rollback";
  note: string;
  is_active: boolean;
  holdout_score: number | null;
  created_at: string;
  created_by_adaptation: number | null;
}

export interface Scenario {
  key: string;
  name: string;
  description: string;
  role: "predefined" | "training" | "holdout";
  params: Record<string, unknown>;
}

export interface Outcome {
  t: number;
  hour: number;
  demand_mw: number;
  served_mw: number;
  unserved_mw: number;
  solar_mw: number;
  wind_mw: number;
  renewable_mw: number;
  thermal_available: boolean;
  thermal_committed_mw: number;
  thermal_output_mw: number;
  battery_discharge_mw: number;
  battery_charge_mw: number;
  soc: number;
  curtailed_mw: number;
  congestion_curtail_mw: number;
  generation_mw: number;
  renewable_share: number;
  emissions_t: number;
  link_flows_mw: Record<string, number>;
  link_capacity_mw: Record<string, number>;
  clipped_actions: { action: string; requested_mw: number; executed_mw: number; reason: string }[];
  invariant_checks: Record<string, boolean>;
  violations: string[];
}

export interface Metrics {
  unserved_mwh: number;
  imbalance_hours: number;
  longest_imbalance_hours: number;
  curtailed_mwh: number;
  emissions_t: number;
  renewable_share: number;
  violations: number;
  clipped_actions: number;
  min_soc: number;
  steps: number;
  score: number;
}

export interface Run {
  id: number;
  scenario: Scenario;
  version: number;
  status: "ready" | "running" | "complete";
  t: number;
  state: Record<string, number>;
  metrics: Metrics | null;
  created_at: string;
  series?: Outcome[];
}

export interface Fired {
  rule: string;
  priority: number;
  directive: string;
  directive_parts: string[];
}

export interface DecisionSummary {
  id: number;
  run: number;
  t: number;
  hour: number;
  alerts: { alert: string; rule: string }[];
  plan: Plan;
  outcome: Outcome;
  fired: string[];
}

export interface Plan {
  thermal_mode: string;
  thermal_commit_target_mw: number;
  battery_priority: string;
  battery_floor: number;
  charge_from_surplus: boolean;
  charge_from_thermal: boolean;
}

export interface AgentReport {
  agent: string;
  facts: Record<string, number>;
  evidence: Record<string, unknown>;
  recommendation: string;
}

export interface Decision extends Omit<DecisionSummary, "fired"> {
  version: number;
  scenario: string;
  facts: Record<string, number>;
  agents: AgentReport[];
  reasoning: { fired: Fired[]; not_fired: string[]; fact_atoms: string[] };
  resolution: { rule: string; directive: string; status: "applied" | "overridden"; by?: string }[];
  settings: Record<string, string>;
  alternatives: { option: string; why_not: string; target_mw?: number }[];
  feasibility: { check: string; ok: boolean; detail: string }[];
  expected: { unserved_mw: number; thermal_committed_mw: number; battery_available_mw: number };
  state_before: Record<string, number>;
  state_after: Record<string, number>;
}

export interface PolicyEval {
  per_scenario: Record<string, Metrics>;
  aggregate: { score: number; unserved_mwh: number; curtailed_mwh: number; emissions_t: number; violations: number; imbalance_hours: number };
}

export interface Candidate {
  rule: Rule;
  passed: boolean;
  status: "accepted" | "rejected";
  reasons: string[];
  training: PolicyEval;
  holdout: PolicyEval;
}

export interface Pattern {
  pattern: string;
  description: string;
  occurrences: number;
  hours: number[];
  remedies: string[];
}

export interface AdaptationSummary {
  id: number;
  from_version: number;
  to_version: number | null;
  status: "accepted" | "rejected" | "no-candidates";
  accepted_rule: Rule | null;
  duration_s: number;
  created_at: string;
  patterns: { pattern: string; occurrences: number }[];
  candidates: { name: string; status: string }[];
}

export interface Adaptation extends AdaptationSummary {
  report: {
    training_scenarios: string[];
    holdout_scenarios: string[];
    acceptance_criteria: Record<string, number>;
    diagnosis: { patterns: Pattern[]; episode_count: number };
    baseline: { training: PolicyEval; holdout: PolicyEval };
    candidates: Candidate[];
    accepted_rule: Rule | null;
    outcome: string;
  };
}

export interface RuleDiff {
  from: number | null;
  to: number;
  added: Rule[];
  removed: Rule[];
  changed: { before: Rule; after: Rule }[];
  unchanged: string[];
}

export interface GridNode {
  id: string;
  name: string;
  kind: string;
  location: string;
  params: Record<string, number>;
}

export interface GridLink {
  id: string;
  source: string;
  target: string;
  capacity_mw: number;
}

export interface AuditEvent {
  id: number;
  kind: string;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Comparison {
  scenario: string;
  weights: Record<string, number>;
  a: { version: number; metrics: Metrics; outcomes: Outcome[] };
  b: { version: number; metrics: Metrics; outcomes: Outcome[] };
}

export interface Evaluation {
  id: number;
  version_a: number;
  version_b: number;
  scenario_keys: string[];
  results: { a: PolicyEval; b: PolicyEval; weights: Record<string, number> };
  created_at: string;
}

export interface Overview {
  active_version: number;
  rule_count: number;
  versions: number;
  adaptations: { accepted: number; rejected: number };
  latest_adaptation: AdaptationSummary | null;
  latest_run: Run | null;
  latest_decision: DecisionSummary | null;
  recent_events: AuditEvent[];
}

export interface Paged<T> {
  count: number;
  results: T[];
}
