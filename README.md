# Prompt evaluation

Gold labels for cases, then three consumers. This repo does not train models.

| Concern | Command | Model server |
| --- | --- | --- |
| Human labels → gold | `aggregate-gold` | no |
| Prompt × model eval | `start` | yes |
| Production tags vs gold | `sample-size`, `qc` | no |
| Gold + cases → JSONL | `export-sft` | no |

## Setup

Node 18+. Copy `.env.example` to `.env`. Set `INPUT_EXPERIMENT` to a folder name under `inputs/` (yours) or `examples/` (shipped). A matching name under `inputs/` wins. If unset, the suite is inferred from `INPUT_*_DIR` (parent of `data/`, `prompts/`, `annotations/`, `labels/`, `schemas/`, or `evaluators/`). Those vars also override the matching folder inside the suite.

For `npm start` only: OpenAI-compatible `MODEL_SERVER_URL` (`/v1/models`, `/v1/chat/completions`). Optional `API_KEY`, `DEFAULT_MODELS`, Slack. Suite `config.json` `model` (temperature, tokens, structured output) and `eval.repeats` override env. Unit tests (no model server): `npm test`.

## Suite layout

| Path | Role |
|------|------|
| `prompts/` | `system_*` + `user_*` with the same suffix (`.txt` or `.md`) |
| `data/` | Cases (`.txt`, `.md`, images, or both) |
| `annotations/` | Human labels (CSV) → gold |
| `labels/` | Gold JSON (`{id}.json`) |
| `predictions/` | Frozen production tags (`qc` only) |
| `evaluators/` | Optional scoring overrides |
| `schemas/` | Optional response schema |
| `config.json` | `model` (decode) + `eval.repeats` |
| `report.json` | Fields to score |

Templates: `examples/suite-template/`, `examples/cat-detector-suite/`.

## Gold

Humans label **cases** (ground truth for each `{id}`). Put those grids in `annotations/` as CSV: shared column names, one row per case. Several annotators can be majority-voted.

```bash
npm run aggregate-gold -- --in inputs/my-suite/annotations --out inputs/my-suite/labels --majority
```

Omit `--in` / `--out` to use `INPUT_EXPERIMENT` (or `INPUT_ANNOTATIONS_DIR` / `INPUT_LABELS_DIR`). Checkbox or `--columns` / `--id` selects columns. Spreadsheet headers (`Subject Type`, `Activity / Action`) are written as snake_case keys matching `report.json` / the schema (`subject_type`). Case id becomes `{stem}.json` (basename; `.jpg` / `.txt` / `.md` stripped). Majority is among non-empty votes; abstentions do not block. Ties go to `annotations/_flags.csv` and are omitted from that JSON key. `_consensus.csv` is the merged grid. Eval, QC, and export use the same id and key transforms and read `labels/` only. Empty and invalid cells are ignored.

`annotations/normalize.json` runs before the vote (NFC, lowercase, spaces, synonyms). Field maps win over `"*"`:

```json
{
  "*": { "n/a": null },
  "color": { "crimson": "red", "scarlet": "red" }
}
```

`--normalize path.json` or `--no-normalize`.

## Prompt evaluation

Calls the model. Gold is not in the prompt. Grid: every user prompt × case × model (`DEFAULT_MODELS` / `config.json`).

```bash
npm install
npm run start:connection
npm start
```

Optional `{suite}/evaluators/` replace repo `evaluators/`. Default scorer: `report.json` fields, `labels/`, `normalize.json`. Custom rules: `examples/cat-detector-suite/`.

```js
evaluateQuantitative(parsed, { input_data_file }) → { fields, format_valid?, bucket?, errors }
evaluateQualitative(parsed, { input_data_file }) → { strengths, weaknesses, suggestions }
```

Harness metrics (not mixed with `format_valid`): **Hamming** (mean field match; `hamming_accuracy` stays a first-class column), **exact match** (all scored fields), **macro-F1** (unweighted mean of per-field F1; omitted only when there are no scored fields). Boolean fields use positive-class F1 (`true`). String fields use class-macro F1 over comma-separated tokens (`N/A` is a class; sklearn `average="macro"`, `zero_division=0`). Hamming still treats a token subset as a miss. Confidence is **not** a number the model writes. `npm start` draws `eval.repeats` samples (default 3) at `model.temperature` (default 0.7), takes the per-field majority JSON, and sets **`confidence_exact`** to that JSON’s vote share and **`confidence_hamming`** to the mean per-field majority vote share. **`brier_exact`** is classical Brier `(confidence_exact − exact_match)²`. **`calibration_mse`** is `(confidence_hamming − Hamming)²` on that case (not Brier 1950). QC (no model) leaves both residuals empty. String fields compare as order-insensitive comma-separated sets (`female, male` equals `male, female`; a subset is a miss). Schema enum `N/A` is a class; blank / `-` / `none` stay unscored. Failed tests are excluded from averages; reports show scored / attempted.

Artifacts: `results/{experiment}/run_{timestamp}/` — `report.md`, `results.csv`, `metrics.csv`, `results.json`; per-model `{model}_results.csv`; `incremental/` per case. `results.csv` identity columns: `experiment`, `model`, `prompt_name`, `input_system_prompt`, `input_user_prompt`, `input_data_file`, then `gold_*` / `pred_*` / `correct_*` (booleans `0`/`1`, empties not `N/A`). `metrics.csv` is one row per model plus `all` (Hamming, exact match, `macro_f1`, `mean_confidence_exact`, `mean_confidence_hamming`, `brier_exact`, `calibration_mse`, per-field precision/recall/F1/accuracy when the suite has scored fields).

```python
import pandas as pd
samples = pd.read_csv("results.csv")
metrics = pd.read_csv("metrics.csv")
metrics.loc[metrics["model"] == "all", ["n", "hamming_accuracy", "exact_match", "mean_confidence_exact", "mean_confidence_hamming", "brier_exact", "calibration_mse"]]
samples.groupby(["model", "input_system_prompt", "input_user_prompt"])["exact_match"].mean()
```

## Production QC

Score **already shipped** tags in `predictions/{id}.json` against gold. Same ids as the reviewer sample. Not `npm start`. Sampling `--confidence` / `--moe` are interval settings, not model self-grades or self-consistency vote shares.

```bash
npm run sample-size -- --confidence 0.95 --moe 0.05 --p 0.9 --N 12000
npm run sample-size -- --strata examples/qc-fixture-suite/strata.csv
INPUT_EXPERIMENT=qc-fixture-suite npm run qc
```

`sample-size`: Wald `n` (optional `--N`, `--strata` with `stratum,N[,p]`). Does not pick ids. `--p` = guessed exact-match rate (`0.5` if unknown).

`qc`: `results/{suite}/qc_*/` — `results.csv`, `metrics.csv`, `qc.json`. Headline: exact match + Wilson interval; Hamming + normal interval (needs n ≥ 2). Unmatched files warn; `--strict` fails. `--predictions` / `--out` override dirs. Example: `examples/qc-fixture-suite/`.

## SFT export

JSONL of gold completions for an external trainer. Hold out ids you still want to `start`. `--prompt` is the pair suffix (`v1` → `system_v1.txt` + `user_v1.txt`, or `.md`).

```bash
npm run export-sft -- --format unsloth --prompt v1 --out train.jsonl
npm run export-sft -- --format text --prompt v1 --out train.jsonl --drop-images
npm run export-sft -- --format llama --prompt v1 --out train.jsonl --holdout holdout-ids.txt
```

`--format`: `text` | `unsloth` | `qwen-vl` | `llama`. `text` cannot include image cases unless `--drop-images`. JSONL lists paths under `data/` — keep those image files with the JSONL when you train.
