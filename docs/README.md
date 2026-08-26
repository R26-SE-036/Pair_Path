# PairPath Documentation

Project documentation for **PairPath** — the behaviour-aware pair-programming
component of Code Guru (SLIIT group R26-SE-036).

The root [`README.md`](../README.md) is the front door: what the project is,
how it's built, and how to run it. Everything here is the detail behind it.

## Contents

| Document | What it covers |
|---|---|
| [architecture.md](architecture.md) | The three services, how a session flows through them, what each datastore holds |
| [local-setup.md](local-setup.md) | Getting all three services running, including the two gotchas that will bite you |
| [api-integration-guide.md](api-integration-guide.md) | REST endpoints, auth, and error shapes — for teammates integrating with PairPath |
| [inter-service-events.md](inter-service-events.md) | Socket.IO event contract and the API ↔ ML service HTTP contract |
| [ml-pipeline.md](ml-pipeline.md) | Raw events → feature windows → labels → trained model, and the guards at each step |
| [annotation-codebook.md](annotation-codebook.md) | The five collaboration states, how to label them, and the judgement calls |
| [evaluation.md](evaluation.md) | Method, results, and what the numbers do and do not mean |
| [development-log.md](development-log.md) | What was built when, and why |
| [deployment.md](deployment.md) | Running the services outside a dev machine |
| [diagrams/](diagrams/) | Architecture and flow diagrams |

## Other documentation in the repo

- [`../ml-service/README.md`](../ml-service/README.md) — ML service specifics:
  endpoints, feature extraction, training guards
- [`../archive/README.md`](../archive/README.md) — why the previous model and
  its training data were retired. Audit evidence for the dissertation.

## Status, in one paragraph

The platform works end to end: authenticated real-time sessions, sandboxed Java
execution, behavioural logging, live classification, and targeted interventions.
The classifier is trained on a **synthetic corpus**, so what has been validated
is the pipeline, not detection accuracy on real students. Collecting and
annotating real sessions is the next phase — see
[evaluation.md](evaluation.md) for exactly what is and isn't claimed.
