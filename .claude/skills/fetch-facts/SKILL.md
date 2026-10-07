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
   `edgar-filing.json`, the primary document, the earnings press release
   (`edgar-press-release.html`, or `.missing` when none is found) and, for a 10-Q,
   the prior 10-K's primary document (`edgar-10k-primary.html`), the latest proxy
   statement when one exists (`edgar-proxy.html`, optional), plus
   `yahoo-history.json` and `capture.json` (stamped with the capture's start time).
   Read the printed directory path.
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
   "All N raw files present" (an `edgar-press-release.missing` marker from step 1
   satisfies the press-release requirement in place of the `.html`, noted on its
   own line). If it lists missing files, retry those calls once; if they still
   fail, stop and report which.
6. `npm run facts:build -- <TICKER> <ACCESSION>` — code maps, validates, and writes
   `data/facts/<TICKER>/<ACCESSION>.json`. Report its output verbatim.
7. Measured beta (optional — skip if the Shibui Finance connector is unavailable):
   `npm run facts:beta -- <TICKER> <ACCESSION>` prints one call. If this session has not
   yet called `mcp__Shibui_Finance__get_database_schema` and then
   `mcp__Shibui_Finance__get_query_patterns`, call them first (the server requires it).
   Then call `mcp__Shibui_Finance__stock_data_query` with `params` exactly as printed and
   save the response byte-for-byte to the printed `file`. Finally run
   `npm run facts:beta -- <TICKER> <ACCESSION> --apply` and report its output verbatim.
   A missing beta is not an error: the cost of equity falls back to the sector proxy.
8. Shibui cross-check (optional — skip if the Shibui Finance connector is unavailable):
   `npm run facts:crosscheck -- <TICKER> <ACCESSION>` prints one call. Make it the same way
   as step 7 (schema + query patterns first if not yet called this session), save the
   response byte-for-byte to the printed `file`, then run
   `npm run facts:crosscheck -- <TICKER> <ACCESSION> --apply` and report its output verbatim.
   A WARN/FAIL line is a finding to report (a vendor input disagrees with Shibui), not
   something to fix by hand; a ticker Shibui does not cover simply gets no diffs.
   A FAIL is now a build blocker: `synth:build` refuses the pack until the fail is either
   fixed in the pack (re-capture, concept fix) or accepted with
   `npm run facts:crosscheck -- <T> <ACC> --accept <field> --reason "<why the pack is right>" --verified-against "<filing>"`.
   Only the owner or the orchestrator accepts a fail, never the author, and only after
   reading the filing's own figure. On a pack re-captured with `facts:free --keep-quote`,
   re-apply the saved response with `--apply --from data/raw/_shibui/<batch>.json` (same
   quote date, so the row still matches).

## Rules

- You do not decide what to fetch: the manifest does.
- You do not decide what a number means: the mappers do.
- You never write a number into any file yourself. If a tool returns nothing
  useful, that is a finding to report, not a gap to fill.
- Tearsheet responses are JSON objects; save the JSON text exactly as returned.
- `bigdata_search` responses are JSON too; save the JSON text exactly as returned.
