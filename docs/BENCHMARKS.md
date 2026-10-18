# Benchmarks

Every number below was produced by `python -m gridmind.benchmark` (run from `backend/`) on 2026-10-18. The simulator is deterministic, so rerunning the command on the same code reproduces these numbers exactly. Nothing here is hand-edited.

## Procedure

1. **Start** from the baseline policy `metta/rules/baseline.metta` (v1, 5 rules).
2. **Experience:** run the training scenario `compound` (afternoon cloud + evening demand surge, seed 7) and record every step.
3. **Diagnose:** each step with unserved demand or congestion becomes an episode. Its measurements are asserted as `(ev …)` atoms and matched against the `pattern` rules in `metta/rules/diagnosis.metta` by the Hyperon runtime.
4. **Propose:** for each matched pattern, MeTTa returns `remedy` templates. Every parameter option of each template is instantiated (in MeTTa, via `let`/`quote`) as a candidate rule, skipping templates already in the policy.
5. **Evaluate:** the current policy and every `current + candidate` policy are simulated on the training scenario and on **8 held-out scenarios** (`holdout-1` … `holdout-8`, generated with fixed seeds 101–108, never used to trigger learning). Same seeds, same initial conditions.
6. **Accept** the best candidate only if **all** hold:
   - held-out composite score improves by ≥ 2%;
   - held-out unserved energy does not increase;
   - no single held-out scenario's score worsens by more than 5%;
   - zero physical-invariant violations;
   - the training scenario improves.

   Otherwise reject every candidate and record why.
7. Repeat from the new version until a round rejects everything.

### Composite score (lower is better)

`score = 50 × unserved_MWh + 2 × curtailed_MWh + 1 × emissions_tCO2 + 1000 × violations`

The weights are fixed in `backend/gridmind/runner.py` and are not tuned per comparison. Unserved energy dominates on purpose: a value of lost load far above energy cost is standard practice. The emissions term means the agent pays for anticipatory thermal commitment (spinning reserve burns fuel), so it cannot win just by over-committing.

### Constraints enforced on every step (checked, not assumed)

Energy balance, battery SoC within [10%, 100%], battery power ≤ 35 MW, no simultaneous charge/discharge, thermal output ≤ committed capacity, thermal = 0 when unavailable, link flows ≤ link capacity. `violations` counts any breach. Across all runs below it is **0**.

## Adaptation rounds

| Round | From | Patterns (steps) | Candidates | Outcome | Accepted rule | Held-out score before -> after |
|---|---|---|---|---|---|---|
| 1 | v1 | commitment-lag (16), premature-depletion (16), congestion-loss (6) | 8 | accepted | thermal-first | 53,160.8 -> 13,695.6 |
| 2 | v2 | congestion-loss (6), commitment-lag (5), premature-depletion (5) | 7 | accepted | (anticipate-ramp 1) | 13,695.6 -> 11,207.1 |
| 3 | v3 | congestion-loss (6), commitment-lag (5), premature-depletion (5) | 4 | rejected | - | 11,207.1 -> 11,207.1 |

Round 3 rejections: `(charge-from-thermal 0.6)`: does not improve the training scenario it was proposed for, held-out score improves 5.8%; `(charge-from-thermal 0.9)`: held-out score improves 18.2%, regresses holdout-7 by 14.9%; `(reserve-floor 0.3)`: does not improve the training scenario it was proposed for, held-out score improves 0.0% (needs >= 2%); `(reserve-floor 0.5)`: does not improve the training scenario it was proposed for, held-out score improves 0.0% (needs >= 2%)


## Held-out comparison (8 generated scenarios, identical seeds)

| Policy | score | unserved_mwh | imbalance_hours | curtailed_mwh | emissions_t | violations |
|---|---|---|---|---|---|---|
| v1 (baseline) | 53,160.8 | 992.4 | 44.5 | 191.9 | 3,155.1 | 0.0 |
| v2 | 13,695.6 | 192.0 | 12.5 | 240.3 | 3,612.9 | 0.0 |
| v3 | 11,207.1 | 140.2 | 11.0 | 240.3 | 3,714.1 | 0.0 |

## Per-scenario composite score (held-out)

| Scenario | v1 (baseline) | v2 | v3 |
|---|---|---|---|
| Held-out #1 (normal) | 7,823.5 | 524.1 | 540.9 |
| Held-out #2 (surge) | 9,449.0 | 1,919.6 | 1,060.1 |
| Held-out #3 (cloud) | 3,526.3 | 545.3 | 557.3 |
| Held-out #4 (compound) | 4,996.0 | 1,952.6 | 1,631.8 |
| Held-out #5 (outage) | 7,463.9 | 3,389.1 | 3,390.0 |
| Held-out #6 (low-battery) | 7,250.6 | 2,183.0 | 990.1 |
| Held-out #7 (wind) | 6,427.2 | 508.7 | 524.7 |
| Held-out #8 (compound) | 6,224.2 | 2,673.2 | 2,512.3 |

## All predefined scenarios (not used for acceptance)

| Scenario | v1 (baseline) unserved MWh / score | v2 unserved MWh / score | v3 unserved MWh / score |
|---|---|---|---|
| Normal operation (predefined) | 116.0 / 6,202 | 0.0 / 501 | 0.0 / 514 |
| Sudden evening demand surge (predefined) | 179.4 / 9,377 | 38.8 / 2,452 | 10.4 / 1,059 |
| Unexpected solar drop (predefined) | 69.1 / 3,953 | 0.0 / 538 | 0.0 / 550 |
| Overnight wind surge (predefined) | 125.6 / 6,641 | 0.0 / 457 | 0.0 / 494 |
| Thermal generator outage (predefined) | 190.6 / 9,896 | 151.8 / 8,015 | 151.8 / 8,017 |
| Battery starts depleted (predefined) | 131.6 / 7,001 | 8.0 / 882 | 0.0 / 494 |
| Solar link congestion (predefined) | 89.6 / 5,525 | 37.9 / 2,968 | 4.3 / 1,306 |
| Evening surge + solar shortfall (training) | 128.8 / 6,943 | 40.2 / 2,560 | 27.1 / 1,913 |

Score weights: {'unserved_mwh': 50.0, 'curtailed_mwh': 2.0, 'emissions_t': 1.0, 'violations': 1000.0}. Runtime: 60 s.

## Reading the results honestly

- **The agent grows twice, then stops.** Round 1 adopts `thermal-first` (serve deficits from committed thermal first and keep the battery for gaps). Round 2 adopts `(anticipate-ramp 1)` (commit thermal ahead of a forecast net-load peak). Round 3 rejects every candidate. The plateau is a result, not a failure: the remaining templates either do not help the training day or harm a held-out day.
- **Context matters.** `charge-from-thermal 0.9` would improve the held-out total by 18% in round 3, but it makes `holdout-7` 14.9% worse, so the per-scenario regression gate rejects it.
- **Trade-offs are real.** On the held-out set, v3 cuts unserved energy from 992 to 140 MWh (−86%), but emits 18% more CO₂ and curtails 25% more renewable energy than v1. Some held-out days get slightly worse on composite score between v2 and v3 (e.g. #1 normal: 524 → 541) because of the extra spinning reserve. All of these stay within the 5% regression limit.
- **What learning cannot fix.** The thermal-outage scenario still loses about 152 MWh: the plant is offline and the battery is finite. The `congestion-loss` pattern is diagnosed every round but has no remedy template, because fixing it needs network reinforcement outside the agent's action space. The UI says so explicitly.
- **Scope of the claim.** This shows a bounded, validated rule-adaptation loop on a small synthetic grid. It does not show generalisation to real networks, and the held-out set is small (8 days).

## Reproduce

```bash
cd backend
../.venv/bin/python -m gridmind.benchmark          # ~60 s
../.venv/bin/python -m pytest tests/test_learning.py  # asserts the held-out improvement and the plateau
```
