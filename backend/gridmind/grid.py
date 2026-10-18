"""Static description of the simulated grid.

Units: power in MW, energy in MWh, time step in hours (DT_H).
All values are illustrative and do not describe any real utility network.

Topology is radial around a single hub bus. Every leaf bus connects to the hub
through one link, so the flow on a link equals the net injection of its leaf
bus. Generation leaves can be congested (renewable output above link capacity
must be curtailed). The battery and the conventional plant sit at the hub.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

DT_H = 0.5  # 30-minute steps
STEPS_PER_DAY = 48


@dataclass
class Node:
    id: str
    name: str
    kind: str  # hub | solar | wind | thermal | battery | load
    location: str
    params: dict = field(default_factory=dict)


@dataclass
class Link:
    id: str
    source: str
    target: str
    capacity_mw: float


@dataclass
class GridConfig:
    nodes: list[Node]
    links: list[Link]

    def node(self, node_id: str) -> Node:
        for n in self.nodes:
            if n.id == node_id:
                return n
        raise KeyError(node_id)

    def nodes_of(self, kind: str) -> list[Node]:
        return [n for n in self.nodes if n.kind == kind]

    def link_for(self, node_id: str) -> Link | None:
        for link in self.links:
            if node_id in (link.source, link.target):
                return link
        return None

    def to_dict(self) -> dict:
        return {"nodes": [asdict(n) for n in self.nodes], "links": [asdict(link) for link in self.links]}

    @classmethod
    def from_dict(cls, data: dict) -> GridConfig:
        return cls(
            nodes=[Node(**n) for n in data["nodes"]],
            links=[Link(**link) for link in data["links"]],
        )


def default_grid() -> GridConfig:
    """The illustrative sample grid used by all built-in scenarios."""
    nodes = [
        Node("hub", "Central Hub Substation", "hub", "Hub", {}),
        Node("solar", "Rift Solar Park", "solar", "West plateau", {"capacity_mw": 90.0}),
        Node("wind", "Lakeside Wind Farm", "wind", "North shore", {"capacity_mw": 40.0}),
        Node(
            "thermal",
            "Hub Thermal Plant",
            "thermal",
            "Hub",
            {
                "capacity_mw": 80.0,
                # Online (committed) capacity can rise by at most this much per step.
                "ramp_mw_per_step": 10.0,
                "emissions_t_per_mwh": 0.45,
                # Fuel burned to keep committed capacity spinning, per MW committed per hour.
                "spinning_t_per_mw_h": 0.06,
            },
        ),
        Node(
            "battery",
            "Hub Battery Store",
            "battery",
            "Hub",
            {
                "energy_capacity_mwh": 100.0,
                "power_mw": 35.0,
                "charge_efficiency": 0.95,
                "discharge_efficiency": 0.95,
                # Hard operating window enforced by the simulator.
                "soc_min": 0.10,
                "soc_max": 1.00,
            },
        ),
        Node("city", "City Load Centre", "load", "Downtown", {"peak_mw": 60.0}),
        Node("industry", "Industrial Park", "load", "East corridor", {"peak_mw": 30.0}),
        Node("homes", "Residential Estates", "load", "Southern suburbs", {"peak_mw": 45.0}),
    ]
    links = [
        Link("L-solar", "solar", "hub", 75.0),
        Link("L-wind", "wind", "hub", 45.0),
        Link("L-city", "hub", "city", 80.0),
        Link("L-industry", "hub", "industry", 45.0),
        Link("L-homes", "hub", "homes", 60.0),
    ]
    return GridConfig(nodes=nodes, links=links)
