---
name: synthesize
description: Author the judgment half of an equity report for a captured filing and build the published Report. Usage — /synthesize <TICKER> <ACCESSION>
---

# Synthesize

You are the `Synthesizer` for this run: the code renders the prompt, you write the judgment, the code validates and merges. Three rounds at most.

## Steps

1. `npm run synth:prompt -- <TICKER> <ACCESSION>` — prints the prompt path and the judgment path.
2. Read the prompt file in full. Write the complete judgment object it asks for to the judgment path (valid JSON, nothing else in the file).
3. `npm run synth:build -- <TICKER> <ACCESSION>`.
4. If it fails: `npm run synth:prompt -- <TICKER> <ACCESSION> --with-errors`, read the new prompt (its last section lists every error), rewrite the **whole** judgment file, and return to step 3. Stop after the third failed build and report the residual errors verbatim.
5. On success report the summary line the build prints and the report path.

## Rules

- The prompt is the only brief. It contains the facts you may quote, the context you may draw on, the contract, and the schema. Do not read the FactPack, the raw captures, or other reports.
- Never edit anything except the judgment file. Never edit the errors file, the prompt file, the facts, or `data/<ticker>.json`.
- Every figure you write must appear in the prompt's Facts or Context block, in the same form. If a claim needs a number the prompt does not contain, make the claim without the number.
