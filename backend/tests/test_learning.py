"""Adaptation: diagnosis, candidate generation, validation gate, and the benchmark."""

import pytest

from gridmind.learning import ACCEPTANCE, adapt, judge, propose_candidates
from gridmind.reasoning import Rule
from gridmind.scenarios import holdout_scenarios, training_scenarios


@pytest.fixture(scope="module")
def round_one(base_rules):
    return adapt(base_rules, training_scenarios(), holdout_scenarios())


def test_holdout_set_is_disjoint_from_training():
    assert not {s["key"] for s in training_scenarios()} & {s["key"] for s in holdout_scenarios()}


def test_candidates_skip_templates_already_in_policy(base_rules, library):
    patterns = [{"remedies": ["thermal-first", "reserve-floor"]}]
    policy = base_rules + [library.instantiate("thermal-first", "()")]
    names = [c.name for c in propose_candidates(patterns, policy, library)]
    assert names == ["(reserve-floor 0.3)", "(reserve-floor 0.5)"]


def test_judge_rejects_scenario_regression():
    cur = {"aggregate": {"score": 100.0, "unserved_mwh": 1.0, "violations": 0},
           "per_scenario": {"a": {"score": 50.0}, "b": {"score": 50.0}}}
    new = {"aggregate": {"score": 80.0, "unserved_mwh": 0.5, "violations": 0},
           "per_scenario": {"a": {"score": 20.0}, "b": {"score": 60.0}}}
    train_cur, train_new = {"aggregate": {"score": 10}}, {"aggregate": {"score": 5}}
    ok, reasons = judge(cur, new, train_cur, train_new)
    assert not ok and any("regresses b" in r for r in reasons)


def test_judge_rejects_violations():
    cur = {"aggregate": {"score": 100.0, "unserved_mwh": 1.0, "violations": 0}, "per_scenario": {}}
    new = {"aggregate": {"score": 10.0, "unserved_mwh": 0.0, "violations": 1}, "per_scenario": {}}
    ok, reasons = judge(cur, new, {"aggregate": {"score": 10}}, {"aggregate": {"score": 5}})
    assert not ok and any("violations" in r for r in reasons)


def test_round_one_diagnoses_the_baseline_failures(round_one):
    found = {p["pattern"] for p in round_one["diagnosis"]["patterns"]}
    assert {"commitment-lag", "premature-depletion"} <= found


def test_benchmark_adapted_policy_beats_baseline_on_holdout(round_one):
    """The core claim: the accepted rule improves held-out performance under identical seeds."""
    assert round_one["outcome"] == "accepted"
    accepted = next(c for c in round_one["candidates"] if c["status"] == "accepted")
    base = round_one["baseline"]["holdout"]
    new = accepted["holdout"]
    assert new["aggregate"]["score"] <= base["aggregate"]["score"] * (1 - ACCEPTANCE["min_holdout_improvement"])
    assert new["aggregate"]["unserved_mwh"] <= base["aggregate"]["unserved_mwh"]
    assert new["aggregate"]["violations"] == 0
    for key, m in new["per_scenario"].items():
        assert m["score"] <= base["per_scenario"][key]["score"] * (1 + ACCEPTANCE["max_scenario_regression"])


def test_rejected_candidates_carry_reasons(round_one):
    rejected = [c for c in round_one["candidates"] if c["status"] == "rejected"]
    assert rejected and all(c["reasons"] for c in rejected)


def test_growth_plateaus_when_nothing_passes(round_one, base_rules):
    rules = base_rules + [Rule.from_dict(round_one["accepted_rule"])]
    second = adapt(rules, training_scenarios(), holdout_scenarios())
    assert second["outcome"] == "accepted"
    third = adapt(rules + [Rule.from_dict(second["accepted_rule"])], training_scenarios(), holdout_scenarios())
    assert third["outcome"] == "rejected"
    assert all(c["status"] == "rejected" for c in third["candidates"])
