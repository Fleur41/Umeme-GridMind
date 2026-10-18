# MeTTa knowledge base

These files are loaded by `backend/gridmind/reasoning.py` into Hyperon (`hyperon==0.2.10`) spaces. They are the source of truth for the agent's behaviour. The Python code does not hard-code any rule.

| File | Contents |
|---|---|
| `rules/core.metta` | `(f name)` fact lookup, `evaluate-rule`, `!(decide)` |
| `rules/baseline.metta` | The five v1 rules |
| `rules/templates.metta` | Candidate rule templates plus `param-option` atoms (the agent's bounded growth space) |
| `rules/diagnosis.metta` | Failure `pattern` rules over episode measurements `(e name)`, and `remedy` links from patterns to templates |

## Rule format

```metta
(rule <name> <priority> <condition> <directive> "<description>")
```

- `condition` is any MeTTa expression that evaluates to `True`/`False` over `(f <fact>)` lookups.
- `directive` is `(set <setting> <value>)` or `(alert <name>)`. Settings understood by the coordinator are `battery-priority` (first/last), `thermal-mode` (reactive/anticipate/offline), `battery-floor` (fraction), `charge-from-surplus` (on/off) and `charge-from-thermal` (on/off).
- When rules conflict on a setting, the higher priority wins.

## Try it directly

```bash
.venv/bin/python - <<'PY'
from hyperon import MeTTa
m = MeTTa()
for f in ["core", "baseline"]:
    m.run(open(f"metta/rules/{f}.metta").read())
m.run("(fact deficit 12) (fact surplus 0) (fact thermal-available 1) (fact congestion-curtail 0) (fact reserve-margin 3)")
print(m.run("!(decide)"))
PY
```
