# Archive

Working documents kept because they are still worth reading, not because
anything depends on them. Nothing here is imported, built or served.

| File | What it is |
|---|---|
| `demo-script.html` | A three-minute walkthrough of the component — the order to show things in so the ML side is visible at all. |
| `ml-next-steps.html` | What is still outstanding on the model. Superseded in parts; read it against the [ML service README](../README.md). |
| `pair-state-runbook.html` | How to get from raw sessions to a trained model: the commands, in order, with what each one checks. |

## The retired model and dataset

The previous model and its training data were withdrawn for four defects:

1. **Circular labels** - the labels were exported from the model's own
   predictions, so it was trained to agree with itself.
2. **Leakage** - splitting by row rather than by session put windows from one
   session in both train and test.
3. **Duplicate rows** in the dataset.
4. **A train/serve mismatch** - the model expected 33 features while production
   supplied 8.
