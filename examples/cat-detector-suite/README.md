# Cat detector eval suite

Image-only **scene audit**: domestic cat, person, wild felid, man-made object. Same images as before. Bundled at `examples/cat-detector-suite/`.

## Run

```
INPUT_EXPERIMENT=cat-detector-suite
```

Suite settings live in `config.json` (temperature, structured output). Gold labels are in `labels/`, never in `data/`.

## Fields

Gold and model JSON. Model JSON also includes `stated_confidence`: the **model’s self-assessment** (how sure it is), not a harness metric. Gold files omit it. The harness copies it into `results.csv` and scores it with **Brier** against exact match.

- `domestic_cat` — domestic cat (*Felis catus*), including photos, drawings, sculptures, stuffed animals. Lions, tigers, cat-shaped plants or food are false.
- `person` — at least one human
- `wildlife_felid` — lion, tiger, and similar. Flowers and dogs are false. Cannot be true with `domestic_cat`.
- `contains_manmade_object` — furniture, vehicles, dishes, signs, textiles, electronics, buildings, walls, fences, toys. Not: sky, grass, trees, dirt, straw, water, unworked stone, plants, animals, seamless studio backdrop.

## Buckets

Each image has one primary `bucket` in its label file (report breakdowns only, not a model output):

- `cat` — one domestic cat, no people
- `no_cat` — no cat and not a cat lookalike
- `multiple_cats` — two or more cats
- `people` — at least one person (may or may not include a cat)
- `clutter` — busy scene with distinct objects
- `lookalikes` — cat-like but not a domestic cat (tiger, lion, cat-face flowers)

## Layout

- `config.json` — temperature, schema, token cap
- `report.json` — field column order
- `prompts/` — paired `system_v1_cat_detector.txt` and `user_v1_cat_detector.txt`
- `schemas/response_format.schema.json` — model output shape
- `data/` — one image per case; unique basenames
- `labels/{basename}.json` — gold booleans and `bucket`
- `evaluators/` — schema validity plus predicted vs gold fields

Do not add a same-basename `.txt` next to an image. Do not put labels in `data/`.

Suite evaluators must export `evaluateQuantitative` and `evaluateQualitative` as in the root README. This suite returns `fields`, `format_valid`, `bucket`, and `errors`. Hamming / exact match / macro-F1 / Brier are added by the harness.

## Scores

- **Format valid** — 1 if JSON keys/types pass and `domestic_cat` and `wildlife_felid` are not both true
- **Hamming accuracy** — mean field match (correct labels / 4)
- **Exact match** — 1 only if every field matches gold
- **Macro-F1** — unweighted mean of per-label F1 over the run (sklearn `average="macro"`, `zero_division=0`)
- **Brier** — harness score of that self-assessment: `(stated_confidence − exact_match)²`. Empty if the model omitted `stated_confidence`.
- **Fields** — `gold_*` / `pred_*` / `correct_*` as `0`/`1` in `results.csv`

Use a vision-capable model in `DEFAULT_MODELS`.
