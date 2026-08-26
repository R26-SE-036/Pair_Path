# Evaluation

What was measured, how, and — importantly — what it does not show.

## Scope of the claim

> These numbers measure **how separable the generator's planted states are**.
> They are not an estimate of accuracy on real students.

The labels are correct by construction with respect to the generator's
definition of each state. Those definitions are design assumptions, not
verified human behaviour. What this validates is that the pipeline works end to
end — extraction, splitting, training, serving — not that the classifier
detects collaboration states in people.

This is a weaker guarantee than it might appear. A planted syntax error *is*
objectively that error; a compiler can confirm it. A planted "driver dominance"
event stream is only correct relative to what we told the generator dominance
looks like.

## Method

**Corpus.** 200 synthetic sessions (40 per state, 12 simulated minutes each)
from a seeded generator. Sliced into 180-second windows at 30-second stride,
minimum 3 events per window, using the same extractor that runs in production.
2,906 windows after removing 787 within-session duplicates.

**Split.** By **session**, not by row: 120 train / 40 validation / 40 test, with
an assertion that no session appears in more than one partition. Windows within
a session are strongly correlated, so row-level splitting would leak.

**Tuning.** A 108-configuration grid over `max_depth`, `learning_rate`,
`n_estimators`, `subsample` and `colsample_bytree`, selected **solely on
validation macro-F1**. The winner was refit on train+validation with balanced
class weights, and the test set was scored **once**.

**Reproduce:**

```bash
cd ml-service && python dev_tools/evaluate_synthetic.py
```

Two consecutive runs produce identical figures.

## Results

**Held-out test: 40 sessions, 580 windows**

| State | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| Productive | 0.863 | 0.901 | 0.882 | 182 |
| Driver dominance | 0.667 | 0.622 | 0.644 | 45 |
| Passive navigator | 0.872 | 0.942 | 0.906 | 138 |
| Logic struggle | 0.973 | 0.877 | 0.922 | 162 |
| Disengaged | 1.000 | 1.000 | 1.000 | 53 |
| **Overall accuracy** | | | **0.891** | 580 |
| **Macro F1** | | | **0.871** | |
| **Weighted F1** | | | **0.891** | |

**Baseline.** An expert rule set over the same features — thresholds taken from
the state definitions, not fitted — scores 0.609 accuracy / 0.615 macro-F1. The
classifier improves on it by **+0.283 accuracy and +0.256 macro-F1**.

**Latency.** Feature extraction plus prediction, 17-event window, n=200: mean
**1.5 ms**, p95 under 4 ms. Unlike the accuracy figures, this one holds for real
deployment — speed doesn't care whether the data is synthetic.

**Principal confusions.** Logic struggle read as productive (18 windows);
dominance ↔ passive navigator (11 and 6); productive read as dominance (9).

## The taxonomy finding

The most useful result was not a number.

Driver dominance and passive navigator were initially both specified with a
near-silent navigator, making them nearly identical in feature space — 48
confused windows and a dominance F1 of **0.523**.

Redefining driver dominance as **a verbally engaged navigator who never receives
the keyboard** — which also matches the intervention each state triggers — cut
that confusion to 15 windows and raised macro-F1 from 0.834 to 0.879.

**That gain came from a definitional correction, not a modelling improvement.**
Two states defined so similarly that no classifier could separate them is a
finding about taxonomy design, and it should be reported as one. The before and
after both belong in the write-up.

## Honest caveats

**Synthetic data is cleaner than reality.** Real sessions contain state
*transitions within* a window; the generator holds one state per session, so
the model has never seen a boundary.

**No inter-rater ceiling exists.** Real annotators disagree, which caps
achievable accuracy. This corpus has no such ceiling, so these numbers are
optimistic by an unknown margin.

**Disengaged at 1.000 is an artefact, not a result.** The generator renders
inactivity trivially sparse; real disengagement is gradual and ambiguous. Flag
this before a reviewer finds it.

**Effective sample size is ~40, not 580.** Windows within a session are
correlated, so confidence intervals should be read at session level. Driver
dominance rests on 45 test windows, leaving its precision wide-intervalled.

**The baseline is weak by design.** It is a hand-written rule set, not a tuned
competitor, so +0.283 is an improvement over simple rules — not over a strong
alternative.

**Edit share is excluded** from both the classifier's reasoning and the baseline
rules, because the read-only navigator editor makes it structurally
uninformative. Rotation timing is the only structural signal separating
dominance from productivity, which is why those remain the residual confusion.

**Per-window, unsmoothed.** No temporal smoothing or consecutive-agreement
policy was applied, though the deployed system supports both and they would
likely improve experienced accuracy.

## What would make this a real result

1. Collect real pair-programming sessions
2. Annotate them by hand, with a second rater on an overlapping subset
3. Report Cohen's kappa — the honest ceiling
4. Settle the window length by ablation rather than assumption
5. Re-run this evaluation against the real labelled set
6. Calibrate the confidence threshold against real data

Step 5 needs no new code — `evaluate_synthetic.py` already implements the
protocol. Only the data is missing.

## A calibration note

On test data, confidence was informative but not uniformly so: windows at 0.9+
were right ~94% of the time, while those in the 0.5–0.7 band were right only
~39%.

The intervention gate sits at **0.6** — inside that unreliable band. That
threshold is provisional and should be set from real annotated data before any
classroom study.
