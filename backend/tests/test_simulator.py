"""Physical constraints and accounting of the simulator."""

import pytest

from gridmind.grid import DT_H, default_grid
from gridmind.runner import run_scenario
from gridmind.scenarios import all_scenarios, build_profiles, get_scenario
from gridmind.simulator import GridState, battery_charge_limit, battery_discharge_limit, execute_step

GRID = default_grid()


def plan(**overrides):
    p = {"thermal_mode": "reactive", "thermal_commit_target_mw": 0.0, "battery_priority": "first",
         "battery_floor": 0.1, "charge_from_surplus": True, "charge_from_thermal": False, "charge_requested": False}
    p.update(overrides)
    return p


def profiles(key="normal", **params):
    return build_profiles({**get_scenario(key)["params"], **params}, GRID)


def test_profiles_are_deterministic():
    a, b = profiles("compound"), profiles("compound")
    assert a.solar_mw == b.solar_mw and a.loads_mw == b.loads_mw and a.forecast_noise == b.forecast_noise


def test_profiles_independent_of_node_order():
    from gridmind.grid import GridConfig

    shuffled = GridConfig(list(reversed(GRID.nodes)), GRID.links)
    params = get_scenario("compound")["params"]
    assert build_profiles(params, GRID).loads_mw == build_profiles(params, shuffled).loads_mw


def test_battery_never_leaves_operating_window():
    b = GRID.node("battery").params
    p = profiles("normal")
    # Night step with large deficit and no thermal: battery drains, but never below soc_min.
    state = GridState(t=0, soc=0.12, thermal_committed_mw=0.0, thermal_output_mw=0.0)
    new, out = execute_step(GRID, p, state, plan())
    assert new.soc >= b["soc_min"] - 1e-9
    assert out["unserved_mw"] > 0
    assert out["battery_discharge_mw"] <= b["power_mw"] + 1e-9


def test_battery_charge_limited_by_capacity():
    assert battery_charge_limit(GRID, 1.0) == 0.0
    assert battery_discharge_limit(GRID, 0.1, 0.1) == 0.0
    assert battery_discharge_limit(GRID, 1.0, 0.1) == GRID.node("battery").params["power_mw"]


def test_thermal_ramp_limit_is_enforced():
    p = profiles("normal")
    state = GridState(t=38, soc=0.1, thermal_committed_mw=10.0, thermal_output_mw=10.0)
    new, out = execute_step(GRID, p, state, plan(thermal_commit_target_mw=80.0))
    assert out["thermal_committed_mw"] == pytest.approx(20.0)
    assert out["clipped_actions"][0]["reason"] == "ramp/capacity limit"


def test_unavailable_thermal_cannot_produce():
    p = profiles("thermal-outage")
    t = int(16 / DT_H)
    state = GridState(t=t, soc=0.5, thermal_committed_mw=60.0, thermal_output_mw=60.0)
    _, out = execute_step(GRID, p, state, plan(thermal_commit_target_mw=60.0))
    assert out["thermal_output_mw"] == 0 and out["thermal_committed_mw"] == 0
    assert out["clipped_actions"][0]["reason"] == "thermal unavailable"


def test_link_capacity_causes_curtailment_not_overload():
    p = profiles("congestion")
    t = int(12 / DT_H)
    _, out = execute_step(GRID, p, GridState(t=t, soc=0.5), plan())
    assert out["solar_mw"] <= 25.0 + 1e-9
    assert out["congestion_curtail_mw"] > 0
    assert out["invariant_checks"]["link_flows_within_capacity"]


@pytest.mark.parametrize("scenario", [s["key"] for s in all_scenarios()])
def test_energy_balance_and_invariants_hold_for_every_step(scenario, base_rules, library):
    policies = [base_rules] + [base_rules + [library.instantiate(n, o)]
                               for n in library.names() for o in library.options(n)[:1]]
    for rules in policies:
        result = run_scenario(rules, get_scenario(scenario)["params"])
        for o in result["outcomes"]:
            assert o["violations"] == [], (scenario, o["t"], o["violations"])
            assert o["demand_mw"] == pytest.approx(o["served_mw"] + o["unserved_mw"], abs=1e-3)
