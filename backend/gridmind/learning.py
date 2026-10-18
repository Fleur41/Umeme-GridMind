"""The adaptation loop: experience -> diagnosis -> candidates -> validation.

1. Run the training scenario with the current policy and record every step.
2. Turn problem steps into episodes and diagnose them with MeTTa patterns.
3. Ask MeTTa which templates remedy the matched patterns, and instantiate
   every parameter option (in MeTTa) as a candidate rule.
4. Evaluate current policy and each candidate policy on the training scenario
   and on held-out scenarios with identical seeds.
5. Accept the best candidate only if it passes every acceptance criterion
   below; otherwise reject all of them and say why.
"""

from __future__ import annotations

from collections import Counter

from .grid import GridConfig, default_grid
from .reasoning import Diagnoser, Rule, TemplateLibrary
from .runner import run_scenario

ACCEPTANCE = {
    "min_holdout_improvement": 0.02,  # composite score must drop by at least 2% on held-out
    "max_scenario_regression": 0.05,  # no single held-out scenario may get >5% worse
    "allow_violations": 0,  # physical invariant breaches are never acceptable
}


def extract_episodes(decisions: list[dict], grid: GridConfig) -> list[dict]:
    th = grid.node("thermal").params
    episodes = []
    ramp_short = []  # per step: commitment requested but blocked by the ramp limit (MW)
    for d in decisions:
        clipped = [c for c in d["outcome"]["clipped_actions"]
                   if c["action"] == "thermal_commit" and c["reason"] == "ramp/capacity limit"]
        ramp_short.append(sum(c["requested_mw"] - c["executed_mw"] for c in clipped))
    for i, d in enumerate(decisions):
        o = d["outcome"]
        if o["unserved_mw"] <= 1e-3 and o["congestion_curtail_mw"] <= 1e-3:
            continue
        uncommitted = (th["capacity_mw"] - o["thermal_committed_mw"]) if o["thermal_available"] else 0.0
        episodes.append(
            {
                "t": o["t"],
                "hour": o["hour"],
                "facts": {
                    "unserved-mw": o["unserved_mw"],
                    "thermal-uncommitted-mw": round(uncommitted, 3),
                    "battery-discharged-earlier-mwh": round(d["state_before"]["battery_discharged_mwh"], 3),
                    "congestion-curtail-mw": o["congestion_curtail_mw"],
                    "recent-ramp-shortfall-mw": round(max(ramp_short[max(0, i - 2): i + 1]), 3),
                },
            }
        )
    return episodes


def diagnose(episodes: list[dict], diagnoser: Diagnoser | None = None) -> dict:
    diagnoser = diagnoser or Diagnoser()
    counts: Counter = Counter()
    examples: dict[str, list[float]] = {}
    for ep in episodes:
        ep["patterns"] = diagnoser.diagnose(ep["facts"])
        for p in ep["patterns"]:
            counts[p] += 1
            examples.setdefault(p, []).append(ep["hour"])
    patterns = [
        {
            "pattern": p,
            "description": diagnoser.descriptions.get(p, ""),
            "occurrences": n,
            "hours": examples[p][:12],
            "remedies": diagnoser.remedies(p),
        }
        for p, n in counts.most_common()
    ]
    return {"patterns": patterns, "episodes": episodes}


def propose_candidates(patterns: list[dict], current: list[Rule], library: TemplateLibrary | None = None) -> list[Rule]:
    library = library or TemplateLibrary()
    existing = {r.name for r in current}
    existing_templates = {r.name.strip("()").split(" ")[0] for r in current}
    seen, candidates = set(), []
    for p in patterns:
        for template in p["remedies"]:
            if template in existing_templates or template in seen:
                continue
            seen.add(template)
            for option in library.options(template):
                rule = library.instantiate(template, option)
                if rule.name not in existing:
                    candidates.append(rule)
    return candidates


def evaluate_policy(rules: list[Rule], scenarios: list[dict], grid: GridConfig | None = None) -> dict:
    grid = grid or default_grid()
    per = {}
    for s in scenarios:
        per[s["key"]] = run_scenario(rules, s["params"], grid=grid)["metrics"]
    agg_keys = ["score", "unserved_mwh", "curtailed_mwh", "emissions_t", "violations", "imbalance_hours"]
    aggregate = {k: round(sum(m[k] for m in per.values()), 3) for k in agg_keys}
    return {"per_scenario": per, "aggregate": aggregate}


def judge(current_eval: dict, cand_eval: dict, current_train: dict, cand_train: dict) -> tuple[bool, list[str]]:
    reasons, ok = [], True
    cur, new = current_eval["aggregate"], cand_eval["aggregate"]
    improvement = (cur["score"] - new["score"]) / cur["score"] if cur["score"] else 0.0
    if cand_train["aggregate"]["score"] >= current_train["aggregate"]["score"]:
        ok = False
        reasons.append("does not improve the training scenario it was proposed for")
    if improvement < ACCEPTANCE["min_holdout_improvement"]:
        ok = False
        reasons.append(f"held-out score improves {improvement:.1%} (needs >= {ACCEPTANCE['min_holdout_improvement']:.0%})")
    else:
        reasons.append(f"held-out score improves {improvement:.1%}")
    if new["unserved_mwh"] > cur["unserved_mwh"] + 1e-6:
        ok = False
        reasons.append(f"held-out unserved energy rises {cur['unserved_mwh']:.1f} -> {new['unserved_mwh']:.1f} MWh")
    if new["violations"] > ACCEPTANCE["allow_violations"]:
        ok = False
        reasons.append(f"{new['violations']} physical constraint violations")
    worst = None
    for key, m in cand_eval["per_scenario"].items():
        base = current_eval["per_scenario"][key]["score"]
        if base > 0:
            change = (m["score"] - base) / base
            if worst is None or change > worst[1]:
                worst = (key, change)
    if worst and worst[1] > ACCEPTANCE["max_scenario_regression"]:
        ok = False
        reasons.append(f"regresses {worst[0]} by {worst[1]:.1%}")
    return ok, reasons


def adapt(current: list[Rule], training: list[dict], holdout: list[dict], grid: GridConfig | None = None,
          progress=None) -> dict:
    """Run one full adaptation round. Returns a JSON-serialisable report."""
    grid = grid or default_grid()
    say = progress or (lambda msg: None)

    say("Replaying training scenario with current policy")
    experience = []
    for s in training:
        run = run_scenario(current, s["params"], grid=grid, keep_decisions=True)
        experience.extend(extract_episodes(run["decisions"], grid))
    diagnosis = diagnose(experience)
    say(f"Diagnosed {len(diagnosis['patterns'])} failure patterns in {len(experience)} problem steps")

    candidates = propose_candidates(diagnosis["patterns"], current)
    say(f"Instantiated {len(candidates)} candidate rules from templates")

    current_train = evaluate_policy(current, training, grid)
    current_hold = evaluate_policy(current, holdout, grid)

    results = []
    for rule in candidates:
        say(f"Evaluating {rule.name}")
        policy = current + [rule]
        train = evaluate_policy(policy, training, grid)
        hold = evaluate_policy(policy, holdout, grid)
        ok, reasons = judge(current_hold, hold, current_train, train)
        results.append({"rule": rule.to_dict(), "passed": ok, "reasons": reasons,
                        "training": train, "holdout": hold})

    passing = [r for r in results if r["passed"]]
    accepted = min(passing, key=lambda r: r["holdout"]["aggregate"]["score"]) if passing else None
    for r in results:
        if accepted is None:
            r["status"] = "rejected"
        elif r is accepted:
            r["status"] = "accepted"
        else:
            r["status"] = "rejected"
            if r["passed"]:
                r["reasons"].append(f"passed, but {accepted['rule']['name']} scored better on held-out")

    return {
        "training_scenarios": [s["key"] for s in training],
        "holdout_scenarios": [s["key"] for s in holdout],
        "acceptance_criteria": ACCEPTANCE,
        "diagnosis": {"patterns": diagnosis["patterns"], "episode_count": len(experience),
                      "episodes": experience[:48]},
        "baseline": {"training": current_train, "holdout": current_hold},
        "candidates": results,
        "accepted_rule": accepted["rule"] if accepted else None,
        "outcome": "accepted" if accepted else ("no-candidates" if not candidates else "rejected"),
    }
