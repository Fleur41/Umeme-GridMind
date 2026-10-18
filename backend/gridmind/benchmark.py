"""Reproducible benchmark: grow the agent from the baseline and report held-out results.

Usage (from backend/):  python -m gridmind.benchmark  [--rounds 4]

Prints Markdown. Every number comes from running the simulator; nothing is
hard-coded. Results are deterministic for a given code version.
"""

from __future__ import annotations

import argparse
import time

from .learning import adapt, evaluate_policy
from .reasoning import Rule, baseline_rules
from .runner import WEIGHTS
from .scenarios import all_scenarios, holdout_scenarios, training_scenarios


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rounds", type=int, default=4)
    args = parser.parse_args()

    started = time.monotonic()
    policies = [("v1 (baseline)", baseline_rules())]
    print("## Adaptation rounds\n")
    print("| Round | From | Patterns (steps) | Candidates | Outcome | Accepted rule | Held-out score before -> after |")
    print("|---|---|---|---|---|---|---|")
    for i in range(args.rounds):
        label, rules = policies[-1]
        report = adapt(rules, training_scenarios(), holdout_scenarios())
        patterns = ", ".join(f"{p['pattern']} ({p['occurrences']})" for p in report["diagnosis"]["patterns"])
        before = report["baseline"]["holdout"]["aggregate"]["score"]
        accepted = next((c for c in report["candidates"] if c["status"] == "accepted"), None)
        after = accepted["holdout"]["aggregate"]["score"] if accepted else before
        print(f"| {i + 1} | {label.split()[0]} | {patterns} | {len(report['candidates'])} | {report['outcome']} | "
              f"{accepted['rule']['name'] if accepted else '-'} | {before:,.1f} -> {after:,.1f} |")
        if not accepted:
            rejected = "; ".join(f"`{c['rule']['name']}`: {', '.join(c['reasons'])}" for c in report["candidates"])
            print(f"\nRound {i + 1} rejections: {rejected}\n")
            break
        policies.append((f"v{len(policies) + 1}", rules + [Rule.from_dict(accepted["rule"])]))

    print("\n## Held-out comparison (8 generated scenarios, identical seeds)\n")
    evals = [(label, evaluate_policy(rules, holdout_scenarios())) for label, rules in policies]
    keys = ["score", "unserved_mwh", "imbalance_hours", "curtailed_mwh", "emissions_t", "violations"]
    print("| Policy | " + " | ".join(keys) + " |")
    print("|---|" + "---|" * len(keys))
    for label, ev in evals:
        print(f"| {label} | " + " | ".join(f"{ev['aggregate'][k]:,.1f}" for k in keys) + " |")

    print("\n## Per-scenario composite score (held-out)\n")
    print("| Scenario | " + " | ".join(label for label, _ in evals) + " |")
    print("|---|" + "---|" * len(evals))
    for s in holdout_scenarios():
        print(f"| {s['name']} | " + " | ".join(f"{ev['per_scenario'][s['key']]['score']:,.1f}" for _, ev in evals) + " |")

    print("\n## All predefined scenarios (not used for acceptance)\n")
    predefined = [s for s in all_scenarios() if s["role"] in ("predefined", "training")]
    pre = [(label, evaluate_policy(rules, predefined)) for label, rules in policies]
    print("| Scenario | " + " | ".join(f"{label} unserved MWh / score" for label, _ in pre) + " |")
    print("|---|" + "---|" * len(pre))
    for s in predefined:
        cells = [f"{ev['per_scenario'][s['key']]['unserved_mwh']:,.1f} / {ev['per_scenario'][s['key']]['score']:,.0f}"
                 for _, ev in pre]
        print(f"| {s['name']} ({s['role']}) | " + " | ".join(cells) + " |")

    print(f"\nScore weights: {WEIGHTS}. Runtime: {time.monotonic() - started:.0f} s.")


if __name__ == "__main__":
    main()
