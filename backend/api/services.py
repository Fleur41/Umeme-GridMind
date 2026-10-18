"""Bridge between the Django models and the framework-free gridmind engine."""

from __future__ import annotations

import time

from django.db import transaction

from gridmind import learning
from gridmind.agents import Coordinator
from gridmind.grid import STEPS_PER_DAY, GridConfig, Link, Node, default_grid
from gridmind.reasoning import PolicyReasoner, Rule, baseline_rules
from gridmind.runner import WEIGHTS, initial_state, run_scenario, step, summarize
from gridmind.scenarios import all_scenarios, build_profiles
from gridmind.simulator import GridState

from .errors import ApiError
from .models import (
    Adaptation,
    AuditEvent,
    Decision,
    Evaluation,
    GridLink,
    GridNode,
    RuleVersion,
    Scenario,
    SimulationRun,
)


def audit(kind: str, message: str, **payload) -> AuditEvent:
    return AuditEvent.objects.create(kind=kind, message=message, payload=payload)


# --------------------------------------------------------------------------- seed


@transaction.atomic
def seed(reset: bool = False) -> None:
    """Load the sample grid, scenario library and baseline policy (idempotent)."""
    if reset:
        for model in (Decision, SimulationRun, Evaluation, Adaptation, AuditEvent):
            model.objects.all().delete()
        RuleVersion.objects.all().delete()
        GridLink.objects.all().delete()
        GridNode.objects.all().delete()
        Scenario.objects.all().delete()

    grid = default_grid()
    for n in grid.nodes:
        GridNode.objects.update_or_create(
            id=n.id, defaults={"name": n.name, "kind": n.kind, "location": n.location, "params": n.params})
    for link in grid.links:
        GridLink.objects.update_or_create(
            id=link.id, defaults={"source_id": link.source, "target_id": link.target, "capacity_mw": link.capacity_mw})
    for i, s in enumerate(all_scenarios()):
        Scenario.objects.update_or_create(
            key=s["key"], defaults={"name": s["name"], "description": s["description"], "role": s["role"],
                                    "params": s["params"], "order": i})
    if not RuleVersion.objects.exists():
        RuleVersion.objects.create(
            version=1, rules=[r.to_dict() for r in baseline_rules()], origin="baseline", is_active=True,
            note="Baseline policy loaded from metta/rules/baseline.metta")
        audit("seed", "Sample grid, scenario library and baseline policy (v1) loaded")


# --------------------------------------------------------------------------- lookups


def grid_config() -> GridConfig:
    nodes = [Node(n.id, n.name, n.kind, n.location, n.params) for n in GridNode.objects.all()]
    links = [Link(link.id, link.source_id, link.target_id, link.capacity_mw) for link in GridLink.objects.all()]
    if not nodes:
        raise ApiError("Grid not seeded. Run `python manage.py seed_gridmind`.", 409, "not_seeded")
    return GridConfig(nodes, links)


def active_version() -> RuleVersion:
    v = RuleVersion.objects.filter(is_active=True).first()
    if v is None:
        raise ApiError("No active rule version. Run `python manage.py seed_gridmind`.", 409, "not_seeded")
    return v


def rules_of(version: RuleVersion) -> list[Rule]:
    return [Rule.from_dict(r) for r in version.rules]


def scenarios_by_role(*roles: str) -> list[dict]:
    return [{"key": s.key, "params": s.params} for s in Scenario.objects.filter(role__in=roles)]


# --------------------------------------------------------------------------- simulation


def create_run(scenario_key: str, version_id: int | None = None) -> SimulationRun:
    scenario = Scenario.objects.filter(key=scenario_key).first()
    if scenario is None:
        raise ApiError(f"Unknown scenario '{scenario_key}'", 404, "not_found")
    version = RuleVersion.objects.filter(version=version_id).first() if version_id else active_version()
    if version is None:
        raise ApiError(f"Unknown rule version {version_id}", 404, "not_found")
    run = SimulationRun.objects.create(scenario=scenario, rule_version=version,
                                       state=initial_state(scenario.params).to_dict())
    audit("simulation.created", f"Run #{run.id}: '{scenario.name}' with rules v{version.version}",
          run=run.id, scenario=scenario.key, version=version.version)
    return run


@transaction.atomic
def advance_run(run: SimulationRun, steps: int) -> list[Decision]:
    run = SimulationRun.objects.select_for_update().get(pk=run.pk)
    if run.status == "complete":
        raise ApiError("Run already complete; reset it to replay.", 409, "run_complete")
    grid = grid_config()
    profiles = build_profiles(run.scenario.params, grid)
    coordinator = Coordinator(grid, PolicyReasoner(rules_of(run.rule_version)))
    state = GridState.from_dict(run.state)
    created = []
    for _ in range(max(1, min(steps, STEPS_PER_DAY - state.t))):
        state, d = step(coordinator, grid, profiles, state)
        created.append(Decision(
            run=run, t=d["outcome"]["t"], hour=d["outcome"]["hour"],
            **{k: d[k] for k in ("facts", "agents", "reasoning", "resolution", "settings", "alerts", "plan",
                                 "alternatives", "feasibility", "expected", "outcome", "state_before",
                                 "state_after")}))
    Decision.objects.bulk_create(created)
    run.state = state.to_dict()
    run.status = "complete" if state.t >= STEPS_PER_DAY else "running"
    if run.status == "complete":
        run.metrics = summarize([d.outcome for d in run.decisions.order_by("t")])
        audit("simulation.completed", f"Run #{run.id} completed (score {run.metrics['score']})",
              run=run.id, metrics=run.metrics)
    run.save()
    return created


@transaction.atomic
def reset_run(run: SimulationRun) -> SimulationRun:
    run.decisions.all().delete()
    run.state = initial_state(run.scenario.params).to_dict()
    run.status, run.metrics = "ready", None
    run.save()
    audit("simulation.reset", f"Run #{run.id} reset", run=run.id)
    return run


def partial_metrics(run: SimulationRun) -> dict | None:
    outcomes = list(run.decisions.order_by("t").values_list("outcome", flat=True))
    return summarize(outcomes) if outcomes else None


# --------------------------------------------------------------------------- reasoning


def reason_about(facts: dict, version: RuleVersion | None = None) -> dict:
    version = version or active_version()
    return PolicyReasoner(rules_of(version)).decide(facts)


# --------------------------------------------------------------------------- learning


def run_adaptation(version: RuleVersion | None = None) -> Adaptation:
    version = version or active_version()
    started = time.monotonic()
    report = learning.adapt(rules_of(version), scenarios_by_role("training"), scenarios_by_role("holdout"),
                            grid=grid_config())
    duration = round(time.monotonic() - started, 2)
    with transaction.atomic():
        adaptation = Adaptation.objects.create(from_version=version, status=report["outcome"],
                                               accepted_rule=report["accepted_rule"], report=report,
                                               duration_s=duration)
        if report["accepted_rule"]:
            accepted = next(c for c in report["candidates"] if c["status"] == "accepted")
            new = RuleVersion.objects.create(
                version=RuleVersion.objects.order_by("-version").first().version + 1,
                rules=version.rules + [report["accepted_rule"]], parent=version, origin="adaptation",
                note=f"Added {report['accepted_rule']['name']}: " + "; ".join(accepted["reasons"]),
                holdout_score=accepted["holdout"]["aggregate"]["score"])
            RuleVersion.objects.filter(is_active=True).update(is_active=False)
            new.is_active = True
            new.save()
            adaptation.to_version = new
            adaptation.save()
            if version.holdout_score is None:
                # Targeted update: saving the stale instance would re-activate it.
                RuleVersion.objects.filter(pk=version.pk).update(
                    holdout_score=report["baseline"]["holdout"]["aggregate"]["score"])
            audit("adaptation.accepted", f"v{version.version} -> v{new.version}: learned "
                  f"{report['accepted_rule']['name']}", adaptation=adaptation.id, version=new.version)
        else:
            audit("adaptation.rejected", f"No candidate passed validation for v{version.version} "
                  f"({len(report['candidates'])} evaluated)", adaptation=adaptation.id)
    return adaptation


@transaction.atomic
def rollback_to(target: RuleVersion) -> RuleVersion:
    current = active_version()
    if current.pk == target.pk:
        raise ApiError(f"v{target.version} is already active", 409, "already_active")
    new = RuleVersion.objects.create(
        version=RuleVersion.objects.order_by("-version").first().version + 1, rules=target.rules, parent=target,
        origin="rollback", note=f"Rollback from v{current.version} to the rules of v{target.version}",
        holdout_score=target.holdout_score)
    RuleVersion.objects.filter(is_active=True).update(is_active=False)
    new.is_active = True
    new.save()
    audit("rules.rollback", f"Rolled back v{current.version} -> rules of v{target.version} (now v{new.version})",
          from_version=current.version, to_version=new.version)
    return new


def rule_diff(old: RuleVersion | None, new: RuleVersion) -> dict:
    before = {r["name"]: r for r in (old.rules if old else [])}
    after = {r["name"]: r for r in new.rules}
    return {
        "from": old.version if old else None,
        "to": new.version,
        "added": [after[n] for n in after if n not in before],
        "removed": [before[n] for n in before if n not in after],
        "changed": [{"before": before[n], "after": after[n]} for n in after
                    if n in before and before[n]["source"] != after[n]["source"]],
        "unchanged": [n for n in after if n in before and before[n]["source"] == after[n]["source"]],
    }


def evaluate(version_a: RuleVersion, version_b: RuleVersion, roles=("holdout",)) -> Evaluation:
    scenarios = scenarios_by_role(*roles)
    grid = grid_config()
    results = {
        "a": learning.evaluate_policy(rules_of(version_a), scenarios, grid),
        "b": learning.evaluate_policy(rules_of(version_b), scenarios, grid),
        "weights": WEIGHTS,
    }
    ev = Evaluation.objects.create(version_a=version_a, version_b=version_b,
                                   scenario_keys=[s["key"] for s in scenarios], results=results)
    audit("evaluation", f"Compared v{version_a.version} vs v{version_b.version} on {len(scenarios)} scenarios",
          evaluation=ev.id)
    return ev


def compare_on_scenario(scenario_key: str, version_a: RuleVersion, version_b: RuleVersion) -> dict:
    """Side-by-side per-step outcomes of two policies on one scenario (same seed, same start)."""
    scenario = Scenario.objects.filter(key=scenario_key).first()
    if scenario is None:
        raise ApiError(f"Unknown scenario '{scenario_key}'", 404, "not_found")
    grid = grid_config()
    out = {"scenario": scenario.key, "weights": WEIGHTS}
    for label, v in (("a", version_a), ("b", version_b)):
        res = run_scenario(rules_of(v), scenario.params, grid=grid)
        out[label] = {"version": v.version, "metrics": res["metrics"], "outcomes": res["outcomes"]}
    return out
