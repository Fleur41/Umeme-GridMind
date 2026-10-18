"""The MeTTa layer: rules are parsed, evaluated and instantiated by the Hyperon runtime."""

from gridmind.agents import Coordinator
from gridmind.grid import default_grid
from gridmind.reasoning import Diagnoser, PolicyReasoner, parse_rules
from gridmind.scenarios import build_profiles, get_scenario
from gridmind.simulator import GridState

FACTS = {"deficit": 12.0, "surplus": 0.0, "thermal-available": 1, "congestion-curtail": 0.0, "reserve-margin": 3.0}


def test_baseline_policy_is_loaded_from_metta(base_rules):
    assert {r.name for r in base_rules} == {"cover-deficit-battery-first", "charge-on-surplus",
                                            "exclude-unavailable-thermal", "flag-congestion", "reserve-alert"}
    assert all(r.source.startswith("(rule ") for r in base_rules)


def test_rules_fire_according_to_facts(base_rules):
    out = PolicyReasoner(base_rules).decide(FACTS)
    assert [f["rule"] for f in out["fired"]] == ["cover-deficit-battery-first", "reserve-alert"]
    assert "charge-on-surplus" in out["not_fired"]
    assert "(fact deficit 12.0)" in out["fact_atoms"]


def test_facts_are_retracted_between_decisions(base_rules):
    r = PolicyReasoner(base_rules)
    r.decide(FACTS)
    out = r.decide({**FACTS, "deficit": 0.0, "surplus": 5.0, "reserve-margin": 50.0})
    assert [f["rule"] for f in out["fired"]] == ["charge-on-surplus"]


def test_rule_with_missing_fact_does_not_fire(base_rules):
    out = PolicyReasoner(base_rules).decide({"deficit": 1.0})
    assert [f["rule"] for f in out["fired"]] == ["cover-deficit-battery-first"]


def test_new_rule_text_changes_behaviour():
    rules = parse_rules('(rule custom 50 (> (f hour) 17) (set thermal-mode anticipate) "evening")')
    assert PolicyReasoner(rules).decide({"hour": 18})["fired"][0]["directive"] == "(set thermal-mode anticipate)"
    assert PolicyReasoner(rules).decide({"hour": 9})["fired"] == []


def test_templates_are_instantiated_in_metta(library):
    rule = library.instantiate("reserve-floor", "(0.5)")
    assert rule.name == "(reserve-floor 0.5)"
    assert "(set battery-floor 0.5)" == rule.directive
    assert set(library.names()) == {"anticipate-ramp", "reserve-floor", "thermal-first", "charge-from-thermal"}


def test_diagnosis_patterns_and_remedies():
    d = Diagnoser()
    patterns = d.diagnose({"unserved-mw": 5, "thermal-uncommitted-mw": 0, "recent-ramp-shortfall-mw": 12,
                           "battery-discharged-earlier-mwh": 40, "congestion-curtail-mw": 0})
    assert patterns == ["commitment-lag", "premature-depletion"]
    assert d.remedies("congestion-loss") == []
    assert "thermal-first" in d.remedies("commitment-lag")


def test_priority_resolution_and_trace(base_rules, library):
    grid = default_grid()
    rules = base_rules + [library.instantiate("thermal-first", "()")]
    profiles = build_profiles(get_scenario("normal")["params"], grid)
    decision = Coordinator(grid, PolicyReasoner(rules)).decide(profiles, GridState(t=36, soc=0.6))
    assert decision["settings"]["battery-priority"] == "last"
    overridden = [r for r in decision["resolution"] if r["status"] == "overridden"]
    assert overridden and overridden[0]["rule"] == "cover-deficit-battery-first"
    assert overridden[0]["by"] == "thermal-first"
    assert {a["agent"] for a in decision["agents"]} == {"renewable", "demand", "storage", "constraint"}
