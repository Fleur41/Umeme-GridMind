"""Run scenarios under a policy and score the result."""

from __future__ import annotations

from .agents import Coordinator
from .grid import DT_H, STEPS_PER_DAY, GridConfig, default_grid
from .reasoning import PolicyReasoner, Rule
from .scenarios import Profiles, build_profiles
from .simulator import GridState, execute_step

# Composite cost (lower is better). Weights are fixed and documented in
# docs/BENCHMARKS.md; they are not tuned per comparison.
WEIGHTS = {
    "unserved_mwh": 50.0,  # value of lost load dominates
    "curtailed_mwh": 2.0,  # wasted renewable energy
    "emissions_t": 1.0,  # tCO2 from thermal output and spinning reserve
    "violations": 1000.0,  # any physical invariant breach
}


def initial_state(params: dict) -> GridState:
    return GridState(soc=params.get("initial_soc", 0.6))


def step(coordinator: Coordinator, grid: GridConfig, profiles: Profiles, state: GridState) -> tuple[GridState, dict]:
    decision = coordinator.decide(profiles, state)
    new_state, outcome = execute_step(grid, profiles, state, decision["plan"])
    decision["outcome"] = outcome
    decision["state_before"] = state.to_dict()
    decision["state_after"] = new_state.to_dict()
    return new_state, decision


def summarize(outcomes: list[dict]) -> dict:
    unserved = sum(o["unserved_mw"] for o in outcomes) * DT_H
    curtailed = sum(o["curtailed_mw"] for o in outcomes) * DT_H
    emissions = sum(o["emissions_t"] for o in outcomes)
    renewable = sum(o["renewable_mw"] for o in outcomes) * DT_H
    served = sum(o["served_mw"] for o in outcomes) * DT_H
    imbalance_steps = sum(1 for o in outcomes if o["unserved_mw"] > 1e-3)
    longest = run = 0
    for o in outcomes:
        run = run + 1 if o["unserved_mw"] > 1e-3 else 0
        longest = max(longest, run)
    violations = sum(len(o["violations"]) for o in outcomes)
    metrics = {
        "unserved_mwh": round(unserved, 3),
        "imbalance_hours": imbalance_steps * DT_H,
        "longest_imbalance_hours": longest * DT_H,
        "curtailed_mwh": round(curtailed, 3),
        "emissions_t": round(emissions, 3),
        "renewable_share": round(renewable / served, 4) if served else 0.0,
        "violations": violations,
        "clipped_actions": sum(len(o["clipped_actions"]) for o in outcomes),
        "min_soc": round(min(o["soc"] for o in outcomes), 4),
        "steps": len(outcomes),
    }
    metrics["score"] = round(sum(WEIGHTS[k] * metrics[k] for k in WEIGHTS), 3)
    return metrics


def run_scenario(rules: list[Rule], params: dict, grid: GridConfig | None = None, keep_decisions: bool = False,
                 reasoner: PolicyReasoner | None = None) -> dict:
    grid = grid or default_grid()
    profiles = build_profiles(params, grid)
    coordinator = Coordinator(grid, reasoner or PolicyReasoner(rules))
    state = initial_state(params)
    decisions = []
    for _ in range(STEPS_PER_DAY):
        state, decision = step(coordinator, grid, profiles, state)
        decisions.append(decision)
    outcomes = [d["outcome"] for d in decisions]
    result = {"metrics": summarize(outcomes), "outcomes": outcomes}
    if keep_decisions:
        result["decisions"] = decisions
    return result
