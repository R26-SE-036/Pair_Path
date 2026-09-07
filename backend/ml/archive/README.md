# Archive

Working documents kept because they are still worth reading, not because
anything depends on them. Nothing here is imported, built or served.

| File | What it is |
|---|---|
| `demo-script.html` | A three-minute walkthrough of the component — the order to show things in so the ML side is visible at all. |
| `ml-next-steps.html` | What is still outstanding on the model. Superseded in parts; read it against `docs/ml-pipeline.md`. |
| `pair-state-runbook.html` | How to get from raw sessions to a trained model: the commands, in order, with what each one checks. |

## The retired model and dataset

Five documents used to cite a `README.md` in this directory as the evidence for
why the previous model and its training data were withdrawn. That file did not
exist — the explanation had been written into
[`docs/ml-pipeline.md`](../../../docs/ml-pipeline.md#why-the-archived-data-was-retired)
instead, where it names all four defects: circular labels exported from the
model's own predictions, row-level splitting that leaked windows from one
session across train and test, duplicate rows, and a model expecting 33
features while production supplied 8.

Those references now point there. Nothing was lost; the citation was simply
aimed at the wrong file.
