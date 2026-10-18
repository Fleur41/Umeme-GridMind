# AI-use disclosure

The BASIX.MARKET hackathon rules require disclosure of AI assistance. This file records it.

## Tools used

| Tool | Role in this project |
|---|---|
| **Claude Code (Anthropic), model Claude Opus 5.5** | Wrote most of the code in this repository in an interactive session with the project owner, including the simulator, MeTTa rule files, Hyperon integration, agents, adaptation loop, Django API, React frontend, tests, Docker/CI configuration and these docs. It also ran the tests, the benchmark and the Docker verification, and debugged the issues they surfaced. |
| **A chat assistant (to be confirmed by the team; see below)** | The project brief and master build prompt given to Claude Code appear to have been drafted with a separate AI chat assistant. |

## What the AI did not do

- It did not train or fine-tune any machine-learning model. The agent's "learning" is the explicit, bounded rule-adaptation loop described in `docs/ARCHITECTURE.md`. No LLM is called at runtime.
- No benchmark number was written by hand. All results in `docs/BENCHMARKS.md` are output of `python -m gridmind.benchmark`.

## Human responsibilities

The project owner chose the challenge, the product direction and the technology stack, and approved the work. Before submitting, the team should review the code, run the demo themselves, and confirm the items below.

## To be completed by the team

- [ ] Name the chat assistant (product and model) used to draft the brief, if any: `__________`
- [ ] List any other AI tools used (image generation for the video, voice-over, editing, etc.): `__________`
- [ ] List team members and their contributions: `__________`
- [ ] Confirm the team has reviewed and run the code: `__________`
