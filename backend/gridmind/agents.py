"""Specialist assessment agents and the coordinating decision agent.

The specialists are lightweight deterministic modules. Each turns what it can
observe (forecasts, telemetry of the previous step) into symbolic facts plus
human-readable evidence. The coordinator asserts those facts into MeTTa,
evaluates the active policy there, resolves conflicting directives by rule
priority, and turns the winning directives into a dispatch plan.

The agent never sees the actual values of the step it is deciding; it sees
forecasts. The simulator then executes the plan against reality.
"""

from __future__ import annotations

from .grid import DT_H, STEPS_PER_DAY, GridConfig
from .reasoning import PolicyReasoner
from .scenarios import Profiles
from .simulator import GridState, battery_charge_limit, battery_discharge_limit, next_commitment

NEAR_HORIZON = 6  # steps (3 h) for the ramp-anticipation forecast

DEFAULTS = {
    "thermal-mode": "reactive",
    "battery-priority": "first",
    "battery-floor": None,  # None -> hardware soc_min
    "charge-from-surplus": "off",
    "charge-from-thermal": "off",
}


def _forecast_renewable(grid: GridConfig, p: Profiles, k: int) -> float:
    noise = p.forecast_noise[k]
    solar = min(p.solar_mw[k] * (2 - noise), p.link_capacity_mw["L-solar"][k])
    wind = min(p.wind_mw[k] * noise, p.link_capacity_mw["L-wind"][k])
    return solar + wind


def _forecast_demand(p: Profiles, k: int) -> float:
    return p.demand(k) * p.forecast_noise[k]


def renewable_agent(grid, p: Profiles, state: GridState) -> dict:
    t = state.t
    noise = p.forecast_noise[t]
    solar_fc = p.solar_mw[t] * (2 - noise)
    wind_fc = p.wind_mw[t] * noise
    solar_cap = p.link_capacity_mw["L-solar"][t]
    wind_cap = p.link_capacity_mw["L-wind"][t]
    congestion = max(0.0, solar_fc - solar_cap) + max(0.0, wind_fc - wind_cap)
    delivered = min(solar_fc, solar_cap) + min(wind_fc, wind_cap)
    return {
        "agent": "renewable",
        "facts": {"renewable-forecast": delivered, "congestion-curtail": congestion},
        "evidence": {"solar_forecast_mw": round(solar_fc, 2), "wind_forecast_mw": round(wind_fc, 2),
                     "solar_link_capacity_mw": solar_cap, "wind_link_capacity_mw": wind_cap},
        "recommendation": (f"Expect {delivered:.1f} MW deliverable renewables"
                           + (f"; {congestion:.1f} MW will be lost to link limits" if congestion > 0.05 else "")),
    }


def demand_agent(grid, p: Profiles, state: GridState) -> dict:
    t = state.t
    demand_fc = _forecast_demand(p, t)
    near = [(_forecast_demand(p, k) - _forecast_renewable(grid, p, k), k)
            for k in range(t, min(STEPS_PER_DAY, t + NEAR_HORIZON))]
    day = [_forecast_demand(p, k) - _forecast_renewable(grid, p, k) for k in range(t, STEPS_PER_DAY)]
    peak, peak_k = max(near)
    day_peak = max(day)
    return {
        "agent": "demand",
        "facts": {"demand": demand_fc, "forecast-net-peak": peak, "forecast-day-peak": day_peak},
        "evidence": {"demand_forecast_mw": round(demand_fc, 2),
                     "net_peak_next_3h_mw": round(peak, 2), "net_peak_at_hour": peak_k * DT_H,
                     "net_peak_rest_of_day_mw": round(day_peak, 2)},
        "recommendation": f"Net load peaks at {peak:.1f} MW within 3 h (hour {peak_k * DT_H:.1f}); "
                          f"{day_peak:.1f} MW later today",
    }


def storage_agent(grid, p: Profiles, state: GridState) -> dict:
    b = grid.node("battery").params
    discharge = battery_discharge_limit(grid, state.soc, b["soc_min"])
    charge = battery_charge_limit(grid, state.soc)
    return {
        "agent": "storage",
        "facts": {"battery-soc": state.soc, "battery-discharge-mw": discharge, "battery-charge-mw": charge},
        "evidence": {"soc": round(state.soc, 3), "energy_mwh": round(state.soc * b["energy_capacity_mwh"], 2),
                     "max_discharge_mw": round(discharge, 2), "max_charge_mw": round(charge, 2)},
        "recommendation": f"Battery at {state.soc:.0%}; can deliver {discharge:.1f} MW or absorb {charge:.1f} MW",
    }


def constraint_agent(grid, p: Profiles, state: GridState) -> dict:
    th = grid.node("thermal").params
    t = state.t
    available = p.thermal_available[t]
    headroom = min(th["ramp_mw_per_step"], th["capacity_mw"] - state.thermal_committed_mw) if available else 0.0
    return {
        "agent": "constraint",
        "facts": {
            "thermal-available": 1 if available else 0,
            "thermal-committed": state.thermal_committed_mw if available else 0.0,
            "thermal-capacity": th["capacity_mw"] if available else 0.0,
            "thermal-ramp": th["ramp_mw_per_step"],
            "thermal-headroom": max(0.0, headroom),
        },
        "evidence": {"thermal_available": available, "committed_mw": round(state.thermal_committed_mw, 2),
                     "ramp_mw_per_step": th["ramp_mw_per_step"], "capacity_mw": th["capacity_mw"],
                     "link_capacity_mw": {k: v[t] for k, v in p.link_capacity_mw.items()}},
        "recommendation": ("Thermal plant OFFLINE - exclude from dispatch" if not available else
                           f"Thermal can reach {state.thermal_committed_mw + max(0.0, headroom):.1f} MW this step"),
    }


SPECIALISTS = [renewable_agent, demand_agent, storage_agent, constraint_agent]


class Coordinator:
    def __init__(self, grid: GridConfig, reasoner: PolicyReasoner):
        self.grid = grid
        self.reasoner = reasoner

    def observe(self, profiles: Profiles, state: GridState) -> tuple[list[dict], dict]:
        reports = [agent(self.grid, profiles, state) for agent in SPECIALISTS]
        facts: dict = {}
        for r in reports:
            facts.update(r["facts"])
        net = facts["demand"] - facts["renewable-forecast"]
        facts["net-load"] = net
        facts["deficit"] = max(0.0, net)
        facts["surplus"] = max(0.0, -net)
        facts["hour"] = state.t * DT_H
        facts["reserve-margin"] = (facts["thermal-committed"] + facts["thermal-headroom"]
                                   + facts["battery-discharge-mw"] - facts["deficit"])
        return reports, {k: round(v, 3) if isinstance(v, float) else v for k, v in facts.items()}

    def decide(self, profiles: Profiles, state: GridState) -> dict:
        reports, facts = self.observe(profiles, state)
        reasoning = self.reasoner.decide(facts)

        # Resolve directives: highest-priority rule wins each setting.
        settings: dict = {}
        resolution = []
        alerts = []
        for f in reasoning["fired"]:  # already sorted by priority desc
            parts = f["directive_parts"]
            if parts[0] == "alert":
                alerts.append({"alert": parts[1], "rule": f["rule"]})
                continue
            if parts[0] == "set":
                key, value = parts[1], parts[2]
                if key in settings:
                    resolution.append({"rule": f["rule"], "directive": f["directive"], "status": "overridden",
                                       "by": settings[key]["rule"]})
                else:
                    settings[key] = {"value": value, "rule": f["rule"]}
                    resolution.append({"rule": f["rule"], "directive": f["directive"], "status": "applied"})

        def setting(key):
            return settings[key]["value"] if key in settings else DEFAULTS[key]

        b = self.grid.node("battery").params
        floor_value = setting("battery-floor")
        floor = max(float(floor_value), b["soc_min"]) if floor_value is not None else b["soc_min"]
        thermal_mode = setting("thermal-mode")
        priority = setting("battery-priority")

        # Thermal commitment target follows the chosen mode.
        battery_planned = battery_discharge_limit(self.grid, state.soc, floor)
        # Operating reserve: commit 10% (min 3 MW) above the forecast need to absorb forecast error.
        reserve = max(3.0, 0.1 * facts["deficit"]) if facts["deficit"] > 0 else 0.0
        if thermal_mode == "offline":
            target = 0.0
        elif thermal_mode == "anticipate":
            target = max(facts["deficit"], facts["forecast-net-peak"]) + reserve
        elif priority == "first":
            target = max(0.0, facts["deficit"] - battery_planned + reserve) if facts["deficit"] > 0 else 0.0
        else:
            target = facts["deficit"] + reserve

        alternatives = []
        if thermal_mode != "anticipate":
            alternatives.append({"option": "commit thermal for the 3 h forecast peak",
                                 "target_mw": round(max(facts["deficit"], facts["forecast-net-peak"]), 2),
                                 "why_not": "no active rule requests anticipatory commitment"})
        if priority == "first" and facts["deficit"] > 0:
            alternatives.append({"option": "serve deficit from thermal before battery",
                                 "why_not": f"rule '{settings.get('battery-priority', {}).get('rule', 'default')}' "
                                            "gives the battery priority"})

        plan = {
            "thermal_mode": thermal_mode,
            "thermal_commit_target_mw": round(target, 3),
            "battery_priority": priority,
            "battery_floor": round(floor, 3),
            "charge_from_surplus": setting("charge-from-surplus") == "on",
            "charge_from_thermal": setting("charge-from-thermal") == "on",
            "charge_requested": facts["surplus"] > 0,
        }

        # Feasibility checks performed before execution.
        th = self.grid.node("thermal").params
        reachable = next_commitment(self.grid, state.thermal_committed_mw, target, bool(facts["thermal-available"]))
        feasibility = [
            {"check": "thermal target within ramp and capacity", "ok": reachable >= target - 1e-6,
             "detail": f"target {target:.1f} MW, reachable {reachable:.1f} MW (ramp {th['ramp_mw_per_step']} MW/step)"},
            {"check": "battery floor within operating window", "ok": b["soc_min"] <= floor <= b["soc_max"],
             "detail": f"floor {floor:.0%}, window {b['soc_min']:.0%}-{b['soc_max']:.0%}"},
            {"check": "thermal excluded when unavailable", "ok": facts["thermal-available"] == 1 or target == 0,
             "detail": "thermal available" if facts["thermal-available"] else "thermal offline, target forced to 0"},
        ]
        battery_now = battery_discharge_limit(self.grid, state.soc, b["soc_min"])
        expected_unserved = max(0.0, facts["deficit"] - reachable - battery_now)
        expected = {"unserved_mw": round(expected_unserved, 3), "thermal_committed_mw": round(reachable, 3),
                    "battery_available_mw": round(battery_now, 3)}

        return {
            "facts": facts,
            "agents": reports,
            "reasoning": reasoning,
            "resolution": resolution,
            "settings": {k: v["value"] for k, v in settings.items()},
            "alerts": alerts,
            "plan": plan,
            "alternatives": alternatives,
            "feasibility": feasibility,
            "expected": expected,
        }
