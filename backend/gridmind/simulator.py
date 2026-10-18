"""Physical simulation of one step.

The simulator receives a dispatch plan (set-points and priorities chosen by
the agent from forecasts) and executes it against the *actual* conditions of
the step. It enforces every physical constraint itself; the agent cannot
make an infeasible action happen by asking for it. Requests that had to be
clipped are reported, and invariant checks are recorded for every step.

Energy accounting per step (MW, multiply by DT_H for MWh):
    renewable_delivered + thermal_output + battery_discharge
        == served_demand + battery_charge
    demand == served_demand + unserved
    renewable_available == renewable_delivered + curtailed (congestion + surplus)
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from .grid import DT_H, GridConfig
from .scenarios import Profiles

EPS = 1e-6


@dataclass
class GridState:
    t: int = 0
    soc: float = 0.6  # battery state of charge, fraction of energy capacity
    thermal_committed_mw: float = 40.0  # online capacity
    thermal_output_mw: float = 40.0
    battery_discharged_mwh: float = 0.0  # cumulative today (used for diagnosis)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> GridState:
        return cls(**d)


def battery_discharge_limit(grid: GridConfig, soc: float, floor: float) -> float:
    """Max discharge power (MW, delivered to the grid) without going below `floor`."""
    b = grid.node("battery").params
    floor = max(floor, b["soc_min"])
    energy = max(0.0, (soc - floor) * b["energy_capacity_mwh"]) * b["discharge_efficiency"]
    return min(b["power_mw"], energy / DT_H)


def battery_charge_limit(grid: GridConfig, soc: float) -> float:
    """Max charge power (MW, drawn from the grid) without exceeding soc_max."""
    b = grid.node("battery").params
    room = max(0.0, (b["soc_max"] - soc) * b["energy_capacity_mwh"]) / b["charge_efficiency"]
    return min(b["power_mw"], room / DT_H)


def next_commitment(grid: GridConfig, prev: float, target: float, available: bool) -> float:
    """Online thermal capacity after this step: rises at most by the ramp limit, can drop instantly."""
    th = grid.node("thermal").params
    if not available:
        return 0.0
    target = min(max(0.0, target), th["capacity_mw"])
    if target > prev:
        return min(target, prev + th["ramp_mw_per_step"])
    return target


def execute_step(grid: GridConfig, profiles: Profiles, state: GridState, plan: dict) -> tuple[GridState, dict]:
    t = state.t
    b = grid.node("battery").params
    th = grid.node("thermal").params

    # --- Renewables and transmission ---------------------------------------
    solar_cap = profiles.link_capacity_mw["L-solar"][t]
    wind_cap = profiles.link_capacity_mw["L-wind"][t]
    solar_avail, wind_avail = profiles.solar_mw[t], profiles.wind_mw[t]
    solar_deliv, wind_deliv = min(solar_avail, solar_cap), min(wind_avail, wind_cap)
    congestion_curtail = (solar_avail - solar_deliv) + (wind_avail - wind_deliv)
    renewable_avail = solar_avail + wind_avail
    renewable = solar_deliv + wind_deliv

    # --- Demand, limited by feeder capacity ---------------------------------
    feeder_unserved = 0.0
    demand = 0.0
    loads = {}
    for node_id, series in profiles.loads_mw.items():
        d = series[t]
        link = grid.link_for(node_id)
        cap = profiles.link_capacity_mw[link.id][t] if link else d
        loads[node_id] = d
        demand += d
        feeder_unserved += max(0.0, d - cap)
    deliverable_demand = demand - feeder_unserved

    # --- Thermal commitment ---------------------------------------------------
    available = profiles.thermal_available[t]
    target = plan["thermal_commit_target_mw"]
    committed = next_commitment(grid, state.thermal_committed_mw, target, available)
    clipped = []
    if target > committed + EPS:
        reason = "thermal unavailable" if not available else "ramp/capacity limit"
        clipped.append({"action": "thermal_commit", "requested_mw": round(target, 3),
                        "executed_mw": round(committed, 3), "reason": reason})

    floor = plan["battery_floor"]
    need = deliverable_demand - renewable
    thermal_out = discharge = charge = unserved = surplus_curtail = 0.0

    if need > 0:
        planned_cap = battery_discharge_limit(grid, state.soc, floor)
        if plan["battery_priority"] == "first":
            discharge = min(need, planned_cap)
            thermal_out = min(need - discharge, committed)
        else:
            thermal_out = min(need, committed)
            discharge = min(need - thermal_out, planned_cap)
        # Emergency: allow discharge down to the hard minimum rather than shed load.
        remaining = need - thermal_out - discharge
        if remaining > EPS:
            hard_cap = battery_discharge_limit(grid, state.soc, b["soc_min"])
            extra = min(remaining, max(0.0, hard_cap - discharge))
            discharge += extra
            remaining -= extra
        unserved = max(0.0, remaining)
        if plan["charge_from_thermal"]:
            # Spare committed thermal first replaces battery discharge, then charges the battery.
            shift = min(discharge, committed - thermal_out)
            discharge -= shift
            thermal_out += shift
            if discharge <= EPS and committed - thermal_out > EPS:
                discharge = 0.0
                charge = min(committed - thermal_out, battery_charge_limit(grid, state.soc))
                thermal_out += charge
    else:
        surplus = -need
        if plan["charge_from_surplus"]:
            charge = min(surplus, battery_charge_limit(grid, state.soc))
        elif plan.get("charge_requested"):
            clipped.append({"action": "battery_charge", "requested_mw": round(surplus, 3), "executed_mw": 0.0,
                            "reason": "charging not enabled by policy"})
        surplus_curtail = surplus - charge
        renewable -= surplus_curtail
        if plan["charge_from_thermal"] and committed > EPS:
            extra = min(committed, battery_charge_limit(grid, state.soc) - charge)
            if extra > EPS:
                thermal_out += extra
                charge += extra

    energy = state.soc * b["energy_capacity_mwh"]
    energy += charge * b["charge_efficiency"] * DT_H - discharge / b["discharge_efficiency"] * DT_H
    new_soc = energy / b["energy_capacity_mwh"]

    unserved_total = unserved + feeder_unserved
    served = demand - unserved_total
    curtailed = congestion_curtail + surplus_curtail
    emissions = thermal_out * DT_H * th["emissions_t_per_mwh"] + committed * DT_H * th["spinning_t_per_mw_h"]

    # --- Invariant checks ----------------------------------------------------
    checks = {
        "energy_balance": abs((renewable + thermal_out + discharge) - (served + charge)) < 1e-4,
        "soc_within_limits": b["soc_min"] - 1e-6 <= new_soc <= b["soc_max"] + 1e-6,
        "battery_power_limit": discharge <= b["power_mw"] + EPS and charge <= b["power_mw"] + EPS,
        "battery_not_charging_and_discharging": charge <= EPS or discharge <= EPS,
        "thermal_within_commitment": thermal_out <= committed + EPS,
        "thermal_off_when_unavailable": available or (committed == 0 and thermal_out == 0),
        "link_flows_within_capacity": solar_deliv <= solar_cap + EPS and wind_deliv <= wind_cap + EPS,
    }
    violations = [k for k, ok in checks.items() if not ok]

    new_state = GridState(
        t=t + 1,
        soc=round(new_soc, 6),
        thermal_committed_mw=round(committed, 6),
        thermal_output_mw=round(thermal_out, 6),
        battery_discharged_mwh=state.battery_discharged_mwh + discharge * DT_H,
    )
    gen = renewable + thermal_out + discharge
    outcome = {
        "t": t,
        "hour": t * DT_H,
        "demand_mw": round(demand, 3),
        "served_mw": round(served, 3),
        "unserved_mw": round(unserved_total, 3),
        "solar_available_mw": round(solar_avail, 3),
        "wind_available_mw": round(wind_avail, 3),
        "solar_mw": round(solar_deliv, 3),
        "wind_mw": round(wind_deliv, 3),
        "renewable_mw": round(renewable, 3),
        "renewable_available_mw": round(renewable_avail, 3),
        "thermal_available": available,
        "thermal_committed_mw": round(committed, 3),
        "thermal_output_mw": round(thermal_out, 3),
        "battery_discharge_mw": round(discharge, 3),
        "battery_charge_mw": round(charge, 3),
        "soc": round(new_soc, 4),
        "curtailed_mw": round(curtailed, 3),
        "congestion_curtail_mw": round(congestion_curtail, 3),
        "generation_mw": round(gen, 3),
        "renewable_share": round(renewable / gen, 4) if gen > EPS else 0.0,
        "emissions_t": round(emissions, 4),
        "link_flows_mw": {"L-solar": round(solar_deliv, 3), "L-wind": round(wind_deliv, 3),
                          **{grid.link_for(n).id: round(v, 3) for n, v in loads.items()}},
        "link_capacity_mw": {k: v[t] for k, v in profiles.link_capacity_mw.items()},
        "clipped_actions": clipped,
        "invariant_checks": checks,
        "violations": violations,
    }
    return new_state, outcome
