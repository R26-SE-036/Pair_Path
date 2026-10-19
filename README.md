# PairPath

The pair-programming component of Code Guru. Two students share one Java
editor in the browser, one driving and one navigating, on an exercise from the
bank or in a free session. PairPath runs their code, watches how the pair is
working, and nudges them when the collaboration goes wrong: one partner doing
everything, the other going quiet, the pair stuck on a mistake, or the session
stalling. A stuck pair gets a hint written for the mistake in their code.
After the session each student answers a short review.

The UI is in `codeguru-web` (`/pair`). This repository is the backend.

## The pieces

| Path | What it is | Port |
|---|---|---|
| `backend/` | NestJS API: accounts linked to Code Coach, sessions, the exercise bank, code runs, reviews, research export, and the Socket.IO gateway for the live session. PostgreSQL through Prisma. | `3001` |
| `backend/ml/` | FastAPI service: predicts the pair's collaboration state from a window of session events, picks the intervention, and returns the hint. See [its README](backend/ml/README.md). | `8020` |
| `code-runner-lambda/` | Compiles and runs one student Java file as an AWS Lambda container image. | - |

How a nudge happens:

```text
session events (edits, runs, chat, role swaps) over the last 180 s
  -> ML service: one of PRODUCTIVE, DRIVER_DOMINANCE, PASSIVE_NAVIGATOR,
     LOGIC_STRUGGLE, DISENGAGED, with a confidence
  -> intervention engine: which nudge, for whom, or none (confidence gate,
     per-session cooldown)
  -> LOGIC_STRUGGLE also gets a hint: Code Coach names the mistake in the
     pair's code and its written hint is used; otherwise one is retrieved
     from the corpus by the exercise's concepts and the run's error text
```

The exercise bank (`backend/src/content/question-bank.ts`) covers all fourteen
platform concepts and invites every one of Code Coach's 30 error types; each
reference solution is compiled and run by a test.

## Running it

The API needs PostgreSQL (`DATABASE_URL`), a `JWT_SECRET`, the ML service
(`ML_SERVICE_URL`) and Code Coach (`CODE_COACH_URL`, and the shared
`INTERNAL_SERVICE_KEY` for hints). Every setting is explained in
[`backend/.env.example`](backend/.env.example).

```bash
cd backend
npm install
npx prisma migrate deploy
npx ts-node prisma/seeds.ts      # the exercise bank, idempotent
npm run start:dev                # http://localhost:3001
```

```bash
cd backend/ml
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python -m app.main # http://localhost:8020
```

Student code runs in the Lambda when `CODE_RUNNER_LAMBDA_FUNCTION` is set, and
in a locked-down `docker run` otherwise.

Then sign in through `codeguru-web` and open **Pair**. Adding `?presenter=1` to
a session's URL shows the ML engine's predictions live beside it, with buttons
that replay a recorded window for each state.

## Tests

```bash
cd backend && npm test                    # API, includes compiling every exercise
cd backend/ml && .venv/Scripts/python -m pytest
cd code-runner-lambda && npm test
```

## Deployment

A push to `main` runs all three test suites, builds the API, ML and code-runner
images, pushes them to ECR and rolls them out on the AWS server
(`.github/workflows/ci-cd.yml`).

## Research tools

`backend/prisma/` holds the scripts behind the evaluation: the nudge-effect
report (`npm run report:nudges`), the consented research export
(`npm run research:export`) and the simulated corpus loader. They connect to
the database in `DATABASE_URL`; read one before running it.
