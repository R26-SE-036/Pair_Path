# Posting GitHub activity to MS Teams

The RP framework asks for one thing: progress should be visible without a
supervisor having to request a report. Planner and GitHub both feed Power
Automate, which posts into the team's Teams channel.

This document covers the **GitHub half**. It is done — the workflow lives at
[`.github/workflows/notify-teams.yml`](../.github/workflows/notify-teams.yml).
What remains is creating the Teams endpoint, which needs a Microsoft account.

## Before you start

**The old method no longer works.** Microsoft disabled Office 365 Connectors —
the "Incoming Webhook" you may find in older tutorials — between 18 and 22 May 2026. Any guide telling you to add an Incoming Webhook connector is out of date.

The replacement is a **Power Automate Workflow**, which is what the RP framework
slides describe.

## Step 1 — create the webhook in Teams

1. Open the Teams channel the team and supervisors use.
2. `...` next to the channel name → **Workflows**.
3. Choose the template **"Post to a channel when a webhook request is received"**.
4. Pick the team and channel, then **Create**.
5. Copy the URL it gives you. It will be on `api.powerautomate.com`,
   `api.powerplatform.com`, or `flow.microsoft.com`.

Treat that URL as a secret — anyone holding it can post into your channel.

## Step 2 — give the URL to GitHub

1. `github.com/R26-SE-036/Pair_Path` → **Settings** → **Secrets and variables**
   → **Actions**.
2. **New repository secret**.
3. Name: `TEAMS_WEBHOOK_URL`. Value: the URL from step 1. **Add secret**.

## Step 3 — check it

Push anything to `main` or `dev`. Under the repository's **Actions** tab a
_Notify Teams_ run appears, and a message should land in the channel.

Until the secret exists the workflow skips with a note in the log. It never
fails a build — a notification problem must not look like a broken project.

## What gets sent

Flat JSON, so the Power Automate flow can lay the message out however the team
prefers:

```json
{
  "kind": "Push to dev",
  "title": "feat: add hint abstention",
  "author": "NimeshHasaranga",
  "detail": "R26-SE-036/Pair_Path",
  "url": "https://github.com/.../commit/abc123",
  "repository": "R26-SE-036/Pair_Path"
}
```

In the flow, map those fields into the "Post card in a chat or channel" step.
Sending fields rather than a pre-built card means changing the message layout
never requires changing this repository.

Triggers: pushes to `main` and `dev`, and pull requests opened, reopened, marked
ready for review, or closed.

## The other half — Planner

Planner → Teams cannot be configured from the repository; it is a Power Automate
flow built in the browser:

1. [make.powerautomate.com](https://make.powerautomate.com) → **Create** →
   **Automated cloud flow**.
2. Trigger: **When a task is completed** (Planner). _When a new task is created_
   is also worth adding.
3. Action: **Post message in a chat or channel** (Teams), pointed at the same
   channel.

Both flows together give the picture the framework asks for: tasks from Planner,
code from GitHub, everything arriving in one channel.

## If nothing arrives

| Symptom                                   | Likely cause                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| Workflow log says "skipping notification" | `TEAMS_WEBHOOK_URL` secret not set, or misspelled                                             |
| HTTP 400                                  | The flow expects a different body shape — open the flow's run history to see what it received |
| HTTP 401 or 403                           | URL expired or the flow was turned off                                                        |
| No workflow run at all                    | The push was to a branch other than `main` or `dev`                                           |

dd
