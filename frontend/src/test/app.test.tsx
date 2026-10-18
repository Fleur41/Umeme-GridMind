import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { change, hhmm, mw } from "../lib/format";
import Simulation from "../pages/Simulation";
import LearningLab from "../pages/LearningLab";

const scenarios = [
  { key: "normal", name: "Normal operation", description: "Typical day", role: "predefined", params: {} },
  { key: "compound", name: "Evening surge + solar shortfall", description: "Training day", role: "training", params: {} },
  { key: "holdout-1", name: "Held-out #1", description: "gen", role: "holdout", params: {} },
];
const rule = (name: string) => ({ name, priority: 10, condition: "(> (f deficit) 0)", directive: "(set x y)", description: `${name} desc`, source: `(rule ${name} ...)` });
const versions = [
  { id: 1, version: 1, rules: [rule("base")], parent: null, origin: "baseline", note: "", is_active: false, holdout_score: 100, created_at: "2026-10-18T10:00:00Z", created_by_adaptation: null },
  { id: 2, version: 2, rules: [rule("base"), rule("thermal-first")], parent: 1, origin: "adaptation", note: "", is_active: true, holdout_score: 40, created_at: "2026-10-18T10:01:00Z", created_by_adaptation: 1 },
];
const evalOf = (score: number) => ({ per_scenario: { "holdout-1": { score } }, aggregate: { score, unserved_mwh: score / 10, curtailed_mwh: 0, emissions_t: 0, violations: 0, imbalance_hours: 0 } });
const adaptation = {
  id: 1, from_version: 1, to_version: 2, status: "accepted", accepted_rule: rule("thermal-first"), duration_s: 12, created_at: "2026-10-18T10:01:00Z",
  patterns: [{ pattern: "commitment-lag", occurrences: 3 }], candidates: [{ name: "thermal-first", status: "accepted" }, { name: "(reserve-floor 0.3)", status: "rejected" }],
  report: {
    training_scenarios: ["compound"], holdout_scenarios: ["holdout-1"], acceptance_criteria: { min_holdout_improvement: 0.02, max_scenario_regression: 0.05 },
    diagnosis: { episode_count: 3, patterns: [{ pattern: "commitment-lag", description: "Ramp lag", occurrences: 3, hours: [19, 19.5], remedies: ["thermal-first"] }] },
    baseline: { training: evalOf(100), holdout: evalOf(100) },
    candidates: [
      { rule: rule("thermal-first"), passed: true, status: "accepted", reasons: ["held-out score improves 60.0%"], training: evalOf(50), holdout: evalOf(40) },
      { rule: rule("(reserve-floor 0.3)"), passed: false, status: "rejected", reasons: ["regresses holdout-1 by 9.0%"], training: evalOf(90), holdout: evalOf(109) },
    ],
    accepted_rule: rule("thermal-first"), outcome: "accepted",
  },
};

function mockFetch(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response(JSON.stringify({ error: { message: `unmocked ${url}` } }), { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }));
  return calls;
}

beforeEach(() => vi.unstubAllGlobals());

describe("format helpers", () => {
  it("formats times, power and relative change", () => {
    expect(hhmm(19.5)).toBe("19:30");
    expect(mw(12.345)).toBe("12.3 MW");
    expect(change(100, 40)).toBeCloseTo(-0.6);
  });
});

describe("Live Simulation", () => {
  it("creates a run for the selected scenario and steps it", async () => {
    const run = { id: 7, scenario: scenarios[1], version: 2, status: "ready", t: 0, state: {}, metrics: null, created_at: "" };
    const outcome = { t: 0, hour: 0, demand_mw: 60, served_mw: 60, unserved_mw: 0, solar_mw: 0, wind_mw: 15, renewable_mw: 15, thermal_available: true, thermal_committed_mw: 45, thermal_output_mw: 45, battery_discharge_mw: 0, battery_charge_mw: 0, soc: 0.6, curtailed_mw: 0, congestion_curtail_mw: 0, generation_mw: 60, renewable_share: 0.25, emissions_t: 10, link_flows_mw: {}, link_capacity_mw: {}, clipped_actions: [], invariant_checks: {}, violations: [] };
    const decision = { id: 99, run: 7, t: 0, hour: 0, alerts: [], plan: { thermal_mode: "reactive", thermal_commit_target_mw: 45, battery_priority: "last", battery_floor: 0.1, charge_from_surplus: false, charge_from_thermal: false }, outcome, fired: ["thermal-first"] };
    const calls = mockFetch({
      "/scenarios/": scenarios, "/agent/rules/versions/": versions,
      "/simulations/7/step/": { ...run, status: "running", t: 1, new_decisions: [decision], metrics: null },
      "/simulations/": run,
    });
    render(<MemoryRouter initialEntries={["/simulation"]}><Routes><Route path="/simulation" element={<Simulation />} /></Routes></MemoryRouter>);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("option", { name: "Normal operation" })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Scenario"), "normal");
    await user.click(screen.getByRole("button", { name: "New run" }));
    const create = calls.find((c) => c.method === "POST" && c.url.endsWith("/simulations/"));
    expect(JSON.parse(create!.body!)).toMatchObject({ scenario: "normal" });
    await user.click(await screen.findByRole("button", { name: /^Step$/ }));
    expect(await screen.findByText("thermal-first")).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith("/simulations/7/step/"))).toBe(true);
  });
});

describe("Learning Lab", () => {
  it("shows the diagnosis, accepted and rejected candidates with reasons, and the rule diff", async () => {
    mockFetch({
      "/agent/rules/versions/2/diff/": { from: 1, to: 2, added: [rule("thermal-first")], removed: [], changed: [], unchanged: ["base"] },
      "/agent/rules/versions/": versions, "/agent/adaptations/1/": adaptation, "/agent/adaptations/": [adaptation],
      "/scenarios/": scenarios,
      "/agent/rules/": { version: versions[1], templates: [{ template: "thermal-first", options: ["()"] }], metta_sources: { "templates.metta": "", "diagnosis.metta": "", "core.metta": "" } },
    });
    render(<MemoryRouter><LearningLab /></MemoryRouter>);
    expect(await screen.findByText("Ramp lag")).toBeInTheDocument();
    expect(await screen.findByText("regresses holdout-1 by 9.0%")).toBeInTheDocument();
    expect(screen.getAllByText("accepted").length).toBeGreaterThan(0);
    expect(await screen.findByText(/\+ added: thermal-first desc/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Roll back to these rules/ })).toBeInTheDocument();
  });
});
