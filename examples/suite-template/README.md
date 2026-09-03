# Suite template

Minimal starting point for any **label grid** (booleans, strings, enums, numbers). Copy to `inputs/{your-suite}/` or set `INPUT_EXPERIMENT=suite-template`.

No suite-specific evaluators are required — the harness falls back to `evaluators/` at the repo root (gold JSON keys + optional `annotations/normalize.json`).

## Workflow

1. Put cases in `data/` (images, text, or both).
2. Export annotator spreadsheets to `annotations/*.csv` (same headers; one row per case).
3. Build gold:

```bash
npm run aggregate-gold -- --in inputs/my-suite/annotations --out inputs/my-suite/labels \
  --id id --columns field_a,field_b --majority
```

4. Add `schemas/` and `report.json` if you use structured output.
5. Run: `INPUT_EXPERIMENT=my-suite npm start`

## Optional overrides

Add `{suite}/evaluators/quantitative.js` only when you need custom rules (e.g. mutual exclusions). Otherwise the default evaluator scores all fields from gold.
