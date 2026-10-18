# Limitations and future work

## Known limitations

- **Simulation only.** Synthetic, illustrative data. There is no connection to any utility, SCADA or live grid, and the output is not operational advice.
- **Simplified physics.** Radial DC-style energy balance with no losses, voltage, frequency or AC power flow. One thermal unit with a simple ramp/commitment model and no minimum up/down times or start-up costs.
- **Bounded learning.** The agent can only add rules instantiated from four hand-written templates (`metta/rules/templates.metta`) with discrete parameter options. It cannot invent new predicates, actions or templates. Rules are only added, never edited or removed (except through manual rollback).
- **Small validation set.** Eight generated held-out days. Improvement there is evidence, not proof of generalisation.
- **Forecasts** are actual values times bounded seeded noise (±5%), which is optimistic compared with real forecasting error.
- **Synchronous adaptation.** `POST /api/agent/adapt/` runs 15–30 s inside the request (the Gunicorn timeout is 180 s). It is fine for a demo but should become a background job for real use.
- **Concurrency.** Simultaneous adaptation requests from several users are not queued.
- **Auth.** Only an optional shared write token (`GRIDMIND_WRITE_TOKEN`). There are no user accounts.
- **Light theme.** The dashboard is designed dark-only.

## Untested or lightly tested

- Frontend tests cover formatting, the simulation controls and the Learning Lab report rendering with mocked API data. Other pages (Topology editing, History, About) are only type-checked and manually viewed.
- No browser end-to-end test suite. The full UI flow was checked manually against a running backend.
- PostgreSQL was verified through Docker Compose (migrations, seed, simulation, adaptation). The automated test suite runs on SQLite.

## Future work

- Let MeTTa propose rule *modifications* (threshold changes, generalisation of conditions) rather than only template instantiations.
- Add rule retirement: test whether removing an old rule still passes the gate.
- Run adaptation as a background task with streamed progress.
- Richer network model (meshed topology, losses) and stochastic forecast error.
