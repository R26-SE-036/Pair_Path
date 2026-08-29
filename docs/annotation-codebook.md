# Annotation Codebook

How to label a window with one of the five collaboration states. This is the
reference to keep open while annotating, and the basis of the dissertation
appendix.

## Before you start

**Numbers here are guides, not tests.** If a rule is just a threshold on the
same values the model measures, the model only relearns your arithmetic — it
would score near 100% and prove nothing. Describe the *situation*, use counts
as hints, and rely on the judgement note.

**The judgement note is the point.** You can see things the features cannot:
what the chat actually says, whether the code is improving, whether failures are
systematic debugging or flailing. That gap between what a count says and what
you conclude is the contribution.

**Two platform facts that shape every definition:**

- The navigator's editor is **read-only**, so every edit comes from the driver.
  Edit share can never distinguish anything.
- **Either partner can take the driver role at any time.** Nobody can be locked
  out, so failure to rotate is shared, not imposed.

---

## PRODUCTIVE

Both students are working on the same problem together. The driver is typing,
the navigator is actively contributing out loud, and they hand the keyboard back
and forth.

*Usually:* steady editing, navigator sending real messages, roles swapping every
few minutes, runs mostly passing or failures resolved.

> **But:** quiet doesn't mean unproductive — a pair thinking through something
> hard may go silent while still working together. And fast, successful runs
> with *no* discussion at all often means one person racing ahead alone: that's
> dominance, not productivity.

## DRIVER_DOMINANCE

One student has held the keyboard for a long stretch while the other stays
verbally engaged. Because either can take the driver role at any time, this is a
**shared failure to rotate**, not one student blocking the other.

*Usually:* no role switch for a long stretch, while the navigator keeps sending
real messages.

> **But:** early in a session nobody has swapped yet — that's normal, not
> dominance. Judge against how long they've been working: no swap at minute 6 is
> nothing, at minute 25 it's the whole story.

## PASSIVE_NAVIGATOR

The navigator isn't contributing at all. Not suggesting, not questioning, not
thinking aloud. The driver works alone.

*Usually:* no messages from the navigator while the driver works steadily.

> **But:** read what they wrote, not how much. Five messages of "ok", "yeah",
> "sure" is passive despite the count. One message of *"wait — that loop starts
> at 1, should it?"* is real contribution. **Judge content, not number.**

## LOGIC_STRUGGLE

Both are working and talking, but stuck — repeated attempts, no progress.

*Usually:* several failed runs in a row, discussion continuing, edits happening
but the code not getting closer.

> **But:** failing a lot isn't the same as being stuck. Systematic debugging —
> change one thing, test, narrow down — is productive even with many failures.
> Struggle looks like repeating the same fix, jumping between unrelated changes,
> or chat showing confusion rather than ideas.

## DISENGAGED

Neither student is really working on the problem any more. Long gaps, little
typing, little talk.

*Usually:* very few actions in the window, almost no discussion.

> **But:** quiet-and-working looks the same on counts as quiet-and-gone — if the
> code is steadily improving through the silence, that's focus. And separate it
> from struggle: a stuck pair is still trying; a disengaged pair has stopped.

---

## Check them in this order

```
DISENGAGED → LOGIC_STRUGGLE → PASSIVE_NAVIGATOR → DRIVER_DOMINANCE → else PRODUCTIVE
```

A window can genuinely look like two things, and **without a fixed order two
annotators can follow the same rules and still disagree**. The order settles it:

- **Struggle beats dominance** — a hint helps more than a role nudge
- **Passive beats dominance** — a silent navigator is the more specific problem

## When you can't tell, skip it

The labelling tool has a skip key. An honest skip costs one window; a forced
wrong label teaches the model something false. Skipping is not failure — it is
data about how clear your definitions are.

## Measuring agreement

Have a second person label an overlapping subset, then:

```bash
python dev_tools/label_windows.py --kappa rater_a.csv rater_b.csv
```

This reports Cohen's kappa and lists every disagreement.

**Kappa is the honest ceiling on any accuracy you later claim.** If two trained
people agree only 75% of the time, a model reporting 90% is measuring something
other than the thing you defined. Below about 0.6, revise the definitions and
re-label rather than proceeding.

It also proves the labels are *not* a mechanical function of the features — if
they were, two annotators would agree perfectly.

## Tighten the numbers after your first 20 windows

Phrases like "a long stretch" and "several" are deliberately loose. Real
thresholds can't be chosen before seeing real sessions.

Label about 20 windows, check whether the wording matched what you saw, adjust,
then continue — and **record that you did it**. Revising a codebook against
early data is normal methodology and belongs in the write-up, not hidden.

## Typical values for orientation

From the simulated corpus — indicative shape only, **not** thresholds:

| State | Edits | Nav msgs | Runs pass | Idle | Since swap |
|---|---|---|---|---|---|
| Productive | 15 | 1 | 1.00 | 0.17 | 210 s |
| Driver dominance | 18 | 1 | 1.00 | 0.06 | 450 s |
| Passive navigator | 16 | 0 | 1.00 | 0.17 | 300 s |
| Logic struggle | 13 | 1 | 0.00 | 0.17 | 383 s |
| Disengaged | 3 | 0 | 0.50 | 0.78 | 450 s |

Read down the columns and each state announces itself on one dimension:
disengaged barely types, struggle fails its runs, passive has a silent
navigator, dominance has gone longest without swapping, productive swapped
recently.

Real students will be messier than this table.
