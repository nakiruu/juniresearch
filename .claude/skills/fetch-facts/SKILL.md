---
name: fetch-facts
description: Capture every vendor response a Juniper report needs for one filing, verbatim, into data/raw/<TICKER>/<ACCESSION>/ — then build the FactPack. Use when a new 10-Q/10-K has been detected or the user says "fetch facts for <ticker>".
---

# fetch-facts

You are the capture step of the fact pipeline. Your entire job is to execute a
manifest that code renders for you: call the named tool with exactly the given
parameters and save the response **verbatim**. You never interpret, reformat,
round, summarise, or omit anything. Every decision lives in code downstream.

## Inputs

`/fetch-facts <TICKER> <ACCESSION>` — e.g. `/fetch-facts AVGO 0001730168-26-000080`.
If the accession is unknown, run `npm run detect` first and use what it prints.

## Steps

1. `npm run facts:prepare -- <TICKER> <ACCESSION>` — creates the raw directory with
   `edgar-filing.json`, the primary document, `yahoo-history.json`, and `capture.json`
   (stamped with the capture's start time). Read the printed directory path.
2. `npm run facts:manifest -- <TICKER> <ACCESSION>` — prints `{ dir, phase2Ready, calls[] }`.
3. For every entry in `calls`:
   - `server: "fmp"` → call the MCP tool `mcp__claude_ai_FMP__<tool>` with `params` exactly as printed.
   - `server: "bigdata"` → call `mcp__claude_ai_Bigdata_com__<tool>` with `params` exactly as printed.
   - Save the tool's response to `<dir>/<file>` **byte-for-byte as the tool returned it**.
     A JSON response is saved as that JSON text; a Markdown response as that Markdown.
     Do not pretty-print, wrap, annotate, or trim.
   - If the call errors, save the error text to `<dir>/<file>.error.txt` and continue.
4. Run step 2 again. If `phase2Ready` is now true, the printed `calls` include the
   three tearsheet entries — execute those the same way.
5. `npm run facts:manifest -- <TICKER> <ACCESSION> --check` — must print
   "All N raw files present". If it lists missing files, retry those calls once;
   if they still fail, stop and report which.
6. `npm run facts:build -- <TICKER> <ACCESSION>` — code maps, validates, and writes
   `data/facts/<TICKER>/<ACCESSION>.json`. Report its output verbatim.

## Rules

- You do not decide what to fetch: the manifest does.
- You do not decide what a number means: the mappers do.
- You never write a number into any file yourself. If a tool returns nothing
  useful, that is a finding to report, not a gap to fill.
- Tearsheet responses are JSON objects; save the JSON text exactly as returned.
- `bigdata_search` responses are JSON too; save the JSON text exactly as returned.
