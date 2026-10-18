"""Deterministic scenario generation.

A scenario is a parameter dict (JSON-serialisable). `build_profiles` expands it
into per-step time series using a seeded RNG, so the same parameters always
produce the same day. Forecasts seen by the agent are derived from the actual
series with independent seeded noise (the agent never sees the future exactly).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from .grid import DT_H, STEPS_PER_DAY, GridConfig


@dataclass
class Profiles:
    solar_mw: list[float]  # available (pre-curtailment) output
    wind_mw: list[float]
    loads_mw: dict[str, list[float]]  # per load node
    thermal_available: list[bool]
    link_capacity_mw: dict[str, list[float]]
    forecast_noise: list[float]  # multiplicative noise applied to forecasts, per step

    def demand(self, t: int) -> float:
        return sum(series[t] for series in self.loads_mw.values())


def _hour(t: int) -> float:
    return t * DT_H


def _bump(h: float, centre: float, width: float) -> float:
    return math.exp(-(((h - centre) / width) ** 2))


def _in_window(h: float, window) -> bool:
    return window is not None and window[0] <= h < window[1]


def build_profiles(params: dict, grid: GridConfig) -> Profiles:
    rng = random.Random(params.get("seed", 0))
    steps = STEPS_PER_DAY

    solar_cap = grid.node("solar").params["capacity_mw"]
    wind_cap = grid.node("wind").params["capacity_mw"]

    cloud = params.get("cloud")  # {"start": h, "end": h, "factor": f}
    solar = []
    for t in range(steps):
        h = _hour(t)
        clear_sky = max(0.0, math.sin(math.pi * (h - 6.0) / 12.5)) if 6.0 <= h <= 18.5 else 0.0
        value = solar_cap * clear_sky * (0.93 + 0.07 * rng.random())
        if cloud and cloud["start"] <= h < cloud["end"]:
            value *= cloud["factor"]
        solar.append(round(value, 3))

    wind_level = params.get("wind_level", 0.35)
    gust = params.get("wind_gust")  # {"start", "end", "level"}
    wind = []
    for t in range(steps):
        h = _hour(t)
        level = wind_level + 0.10 * math.sin(2 * math.pi * (h + 3) / 24) + 0.05 * (rng.random() - 0.5)
        if gust and gust["start"] <= h < gust["end"]:
            level = gust["level"] + 0.04 * (rng.random() - 0.5)
        wind.append(round(wind_cap * min(1.0, max(0.0, level)), 3))

    surge = params.get("surge")  # {"start", "end", "factor"}
    load_scale = params.get("load_scale", 1.0)
    shapes = {
        "city": lambda h: 0.55 + 0.25 * _bump(h, 8.0, 1.5) + 0.45 * _bump(h, 19.5, 2.0),
        "industry": lambda h: 0.45 + 0.55 * (1.0 if 7.5 <= h < 17.5 else 0.0),
        "homes": lambda h: 0.25 + 0.20 * _bump(h, 7.0, 1.2) + 0.75 * _bump(h, 20.0, 1.8),
    }
    loads: dict[str, list[float]] = {}
    for node in sorted(grid.nodes_of("load"), key=lambda n: n.id):
        shape = shapes.get(node.id, lambda h: 0.6)
        series = []
        for t in range(steps):
            h = _hour(t)
            value = node.params["peak_mw"] * min(1.0, shape(h)) * load_scale * (0.97 + 0.06 * rng.random())
            if surge and surge["start"] <= h < surge["end"] and node.id in surge.get("nodes", ["city", "homes"]):
                value *= surge["factor"]
            series.append(round(value, 3))
        loads[node.id] = series

    outage = params.get("thermal_outage")  # [start_h, end_h]
    thermal_available = [not _in_window(_hour(t), outage) for t in range(steps)]

    link_caps = {link.id: [link.capacity_mw] * steps for link in grid.links}
    for override in params.get("link_derate", []):  # {"link", "start", "end", "capacity_mw"}
        series = link_caps[override["link"]]
        for t in range(steps):
            if override["start"] <= _hour(t) < override["end"]:
                series[t] = override["capacity_mw"]

    noise_rng = random.Random(params.get("seed", 0) * 7919 + 17)
    forecast_noise = [round(1.0 + noise_rng.uniform(-0.05, 0.05), 4) for _ in range(steps)]

    return Profiles(solar, wind, loads, thermal_available, link_caps, forecast_noise)


# ---------------------------------------------------------------------------
# Scenario library
# ---------------------------------------------------------------------------

EVENING_SURGE = {"start": 17.0, "end": 22.0, "factor": 1.18, "nodes": ["city", "homes"]}
AFTERNOON_CLOUD = {"start": 13.0, "end": 18.5, "factor": 0.35}

PREDEFINED: list[dict] = [
    {
        "key": "normal",
        "name": "Normal operation",
        "description": "Typical day: morning and evening peaks, clear skies, moderate wind.",
        "params": {"seed": 1},
    },
    {
        "key": "evening-surge",
        "name": "Sudden evening demand surge",
        "description": "City and residential demand jump 18% between 17:00 and 22:00.",
        "params": {"seed": 2, "surge": EVENING_SURGE},
    },
    {
        "key": "solar-drop",
        "name": "Unexpected solar drop",
        "description": "Heavy cloud cuts solar output to 35% from 13:00 to sunset.",
        "params": {"seed": 3, "cloud": AFTERNOON_CLOUD},
    },
    {
        "key": "wind-surge",
        "name": "Overnight wind surge",
        "description": "Wind rises to 90% of capacity between 01:00 and 06:00, creating surplus.",
        "params": {"seed": 4, "wind_gust": {"start": 1.0, "end": 6.0, "level": 0.9}},
    },
    {
        "key": "thermal-outage",
        "name": "Thermal generator outage",
        "description": "The thermal plant trips offline from 15:00 to 18:00.",
        "params": {"seed": 5, "thermal_outage": [15.0, 18.0]},
    },
    {
        "key": "battery-low",
        "name": "Battery starts depleted",
        "description": "The day begins with the battery at 15% state of charge.",
        "params": {"seed": 6, "initial_soc": 0.15},
    },
    {
        "key": "congestion",
        "name": "Solar link congestion",
        "description": "Maintenance derates the solar transmission link to 25 MW from 10:00 to 15:00.",
        "params": {
            "seed": 8,
            "link_derate": [{"link": "L-solar", "start": 10.0, "end": 15.0, "capacity_mw": 25.0}],
        },
    },
    {
        "key": "compound",
        "name": "Evening surge + solar shortfall",
        "description": "Compound event: afternoon cloud followed by an evening demand surge. "
        "This is the experience the agent learns from.",
        "params": {"seed": 7, "cloud": AFTERNOON_CLOUD, "surge": EVENING_SURGE},
        "role": "training",
    },
]


def generated_holdout(count: int = 8, base_seed: int = 100) -> list[dict]:
    """Held-out scenarios: randomised variants never used to trigger learning."""
    rng = random.Random(base_seed)
    families = ["normal", "surge", "cloud", "compound", "outage", "low-battery", "wind", "compound"]
    scenarios = []
    for i in range(count):
        family = families[i % len(families)]
        seed = base_seed + i + 1
        params: dict = {"seed": seed, "load_scale": round(rng.uniform(0.95, 1.05), 3)}
        if family in ("surge", "compound"):
            start = round(rng.uniform(16.5, 18.0) * 2) / 2
            params["surge"] = {"start": start, "end": start + 4.5, "factor": round(rng.uniform(1.10, 1.22), 3),
                               "nodes": ["city", "homes"]}
        if family in ("cloud", "compound"):
            start = round(rng.uniform(11.0, 14.0) * 2) / 2
            params["cloud"] = {"start": start, "end": 18.5, "factor": round(rng.uniform(0.25, 0.55), 3)}
        if family == "outage":
            start = round(rng.uniform(13.0, 17.0) * 2) / 2
            params["thermal_outage"] = [start, start + round(rng.uniform(1.5, 3.0) * 2) / 2]
        if family == "low-battery":
            params["initial_soc"] = round(rng.uniform(0.12, 0.25), 3)
        if family == "wind":
            params["wind_level"] = round(rng.uniform(0.15, 0.55), 3)
        scenarios.append(
            {
                "key": f"holdout-{i + 1}",
                "name": f"Held-out #{i + 1} ({family})",
                "description": f"Generated {family} variant (seed {seed}). Never used to trigger learning.",
                "params": params,
                "role": "holdout",
            }
        )
    return scenarios


def all_scenarios() -> list[dict]:
    out = []
    for s in PREDEFINED:
        out.append({"role": "predefined", **s})
    out.extend(generated_holdout())
    return out


def get_scenario(key: str) -> dict:
    for s in all_scenarios():
        if s["key"] == key:
            return s
    raise KeyError(key)


def training_scenarios() -> list[dict]:
    return [s for s in all_scenarios() if s["role"] == "training"]


def holdout_scenarios() -> list[dict]:
    return [s for s in all_scenarios() if s["role"] == "holdout"]
