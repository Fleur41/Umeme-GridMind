"""MeTTa/Hyperon reasoning layer.

Everything in this module runs through the Hyperon runtime: rule evaluation,
template instantiation, and failure diagnosis. Python only formats facts in and
parses result atoms out.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from hyperon import MeTTa

METTA_DIR = Path(os.environ.get("GRIDMIND_METTA_DIR", Path(__file__).resolve().parents[2] / "metta" / "rules"))


def _read(name: str) -> str:
    return (METTA_DIR / name).read_text()


def _fmt(value) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return repr(round(float(value), 4))
    return str(value)


@dataclass
class Rule:
    """One policy rule. `source` is the exact MeTTa atom text."""

    name: str
    priority: int
    condition: str
    directive: str
    description: str
    source: str

    def to_dict(self) -> dict:
        return self.__dict__.copy()

    @classmethod
    def from_dict(cls, d: dict) -> "Rule":
        return cls(**{k: d[k] for k in ("name", "priority", "condition", "directive", "description", "source")})


def _rule_from_atom(atom) -> Rule:
    # atom is (rule name prio cond directive desc)
    _, name, prio, cond, directive, desc = atom.get_children()
    return Rule(
        name=str(name),
        priority=int(str(prio)),
        condition=str(cond),
        directive=str(directive),
        description=str(desc).strip('"'),
        source=str(atom),
    )


def parse_rules(source: str) -> list[Rule]:
    """Parse rule atoms out of MeTTa source using the MeTTa runtime itself."""
    m = MeTTa()
    m.run(source)
    results = m.run("!(match &self (rule $n $p $c $d $t) (quote (rule $n $p $c $d $t)))")[0]
    rules = [_rule_from_atom(r.get_children()[1]) for r in results]
    return sorted(rules, key=lambda r: (-r.priority, r.name))


def baseline_rules() -> list[Rule]:
    return parse_rules(_read("baseline.metta"))


def render_policy(rules: list[Rule]) -> str:
    return "\n\n".join(r.source for r in rules)


class PolicyReasoner:
    """Holds one policy in a MeTTa space and evaluates it against fact sets."""

    def __init__(self, rules: list[Rule]):
        self.rules = rules
        self.metta = MeTTa()
        self.metta.run(_read("core.metta"))
        self.metta.run(render_policy(rules))
        self._space = self.metta.space()

    def decide(self, facts: dict) -> dict:
        atoms = [self.metta.parse_single(f"(fact {k} {_fmt(v)})") for k, v in facts.items()]
        for a in atoms:
            self._space.add_atom(a)
        try:
            results = self.metta.run("!(decide)")[0]
        finally:
            for a in atoms:
                self._space.remove_atom(a)

        fired, not_fired = [], []
        for res in results:
            kids = res.get_children()
            head = str(kids[0])
            if head == "fired":
                directive = kids[3]
                fired.append(
                    {
                        "rule": str(kids[1]),
                        "priority": int(str(kids[2])),
                        "directive": str(directive),
                        "directive_parts": [str(c) for c in directive.get_children()],
                    }
                )
            elif head == "not-fired":
                not_fired.append(str(kids[1]))
            else:
                # A condition that did not reduce to True/False (e.g. missing fact).
                not_fired.append(str(res))
        fired.sort(key=lambda x: -x["priority"])
        return {"fired": fired, "not_fired": sorted(not_fired), "fact_atoms": [str(a) for a in atoms]}


class TemplateLibrary:
    """Candidate rule templates, instantiated by MeTTa."""

    def __init__(self):
        self.metta = MeTTa()
        self.metta.run(_read("templates.metta"))

    def options(self, template: str) -> list[str]:
        res = self.metta.run(f"!(match &self (param-option {template} $p) (quote $p))")[0]
        return [str(r.get_children()[1]) for r in res]

    def instantiate(self, template: str, option: str) -> Rule:
        res = self.metta.run(f"!(match &self (template {template} $ps $r) (let $ps {option} (quote $r)))")[0]
        if not res:
            raise ValueError(f"template {template} could not be instantiated with {option}")
        return _rule_from_atom(res[0].get_children()[1])

    def names(self) -> list[str]:
        res = self.metta.run("!(match &self (template $n $ps $r) $n)")[0]
        return sorted({str(r) for r in res})


class Diagnoser:
    """Symbolic failure-pattern detection over recorded experience."""

    def __init__(self):
        self.metta = MeTTa()
        self.metta.run(_read("diagnosis.metta"))
        self._space = self.metta.space()
        self.descriptions = {
            str(r.get_children()[0]): str(r.get_children()[1]).strip('"')
            for r in self.metta.run("!(match &self (pattern $n $c $d) ($n $d))")[0]
        }

    def diagnose(self, episode: dict) -> list[str]:
        atoms = [self.metta.parse_single(f"(ev {k} {_fmt(v)})") for k, v in episode.items()]
        for a in atoms:
            self._space.add_atom(a)
        try:
            results = self.metta.run("!(diagnose)")[0]
        finally:
            for a in atoms:
                self._space.remove_atom(a)
        return sorted(str(r.get_children()[1]) for r in results if str(r.get_children()[0]) == "matched")

    def remedies(self, pattern: str) -> list[str]:
        res = self.metta.run(f"!(match &self (remedy {pattern} $t) $t)")[0]
        return sorted(str(r) for r in res)
