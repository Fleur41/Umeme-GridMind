# Three-minute demo script

**Before recording:** start the backend and frontend (see README). Open **Settings / About → Reset demo** so the agent starts at v1. Run one adaptation round once off-camera if you want a warm cache, then reset again. Keep a second tab on the Learning Lab.

All numbers quoted below come from `docs/BENCHMARKS.md` and are reproducible. If your run differs, quote what is on screen.

| Time | Screen | What to show / say |
|---|---|---|
| **0:00–0:25** | Overview | "Grids now juggle solar, wind, batteries and slow thermal plants. Fixed rules work until conditions change. Umeme GridMind is an agent whose rules are written in MeTTa, and it learns new ones from experience. Everything here is simulated." Point at the *SIMULATED DATA MODE* badge. |
| **0:25–0:55** | Grid Topology → Learning Lab (Active rule base) | Show the radial grid: solar and wind behind capacity-limited links, the ramp-limited thermal plant, and the battery at the hub. Then show the five baseline rules **as MeTTa source**, e.g. `cover-deficit-battery-first`: "it drains the battery before committing thermal." |
| **0:55–1:25** | Live Simulation | Pick **Evening surge + solar shortfall**, rules **v1**, *New run*, *Run to end*. Point at the red unserved bars around 18:00–21:00 and the battery hitting its 10% floor first. "The baseline lost about 129 MWh on this day." |
| **1:25–1:55** | Click a red step → Agent Reasoning | Walk the pipeline: agent evidence → the facts asserted into the Hyperon space → the rule table (which fired) → plan → feasibility (*thermal target within ramp: ✗*) → expected vs actual. "Every decision is inspectable, and you can challenge it": change `deficit` in *Challenge this decision* and re-run MeTTa. |
| **1:55–2:25** | Learning Lab → *Run adaptation round* | While it runs: "It replays the day, asserts each failure into MeTTa, matches failure patterns (commitment lag, premature depletion), and MeTTa instantiates candidate rules from templates." Then show the diagnosis, the candidate table (accepted vs rejected, with reasons) and the **rule diff** adding `thermal-first`. Run a second round: `(anticipate-ramp 1)` is accepted. Optionally a third: everything is rejected, and the agent explains why (e.g. *regresses holdout-7 by 14.9%*). |
| **2:25–2:50** | Learning Lab → Before vs after | Policy A **v1**, Policy B **v3**, scenario **Held-out #2 (surge)**, *Compare day*. Then *Benchmark all held-out*: "On 8 held-out days it never learned from, unserved energy drops from 992 to 140 MWh with zero constraint violations. It costs about 18% more emissions, and the agent can't fix a plant outage. We show that too." |
| **2:50–3:00** | Growth timeline | "v1 → v2 → v3: each change is validated, recorded, diffable and reversible." Click *Roll back* on v1 to show reversibility. "Next: let MeTTa edit thresholds, not just add rules." |
