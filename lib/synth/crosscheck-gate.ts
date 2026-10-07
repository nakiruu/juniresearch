/**
 * crosscheck-gate.ts — the build refuses a FactPack whose Shibui cross-check holds a `fail` the owner has not
 * accepted. Audit 2026-10-06 (D-27): CFG was published on a fee-revenue subset five days after the check had
 * stamped `revenueQuarter 79% fail`, because the levels gated nothing. An accepted fail is recorded on the pack
 * (`crosscheckOverrides`, stamped by `facts:crosscheck --accept`) with the reason and what it was verified against.
 */
import type { ShibuiCheck, CrosscheckOverride } from "../facts/shibui-check";
import { compactNumber } from "./intrinsic";

export interface CrosscheckGateResult { blocked: boolean; errors: string[]; warnings: string[] }

export function crosscheckGate(pack: { shibuiCheck?: ShibuiCheck; crosscheckOverrides?: CrosscheckOverride[] }): CrosscheckGateResult {
  const sc = pack.shibuiCheck;
  if (!sc) return { blocked: false, errors: [], warnings: ["input check (Shibui): none on this pack"] };
  const overrides = new Map((pack.crosscheckOverrides ?? []).map((o) => [o.field, o]));
  const errors: string[] = [], warnings: string[] = [];
  for (const d of sc.diffs) {
    if (d.level === "ok") continue;
    const line = `${d.level === "fail" ? "FAIL" : "warn"} ${d.field} ${compactNumber(d.pack)} vs ${compactNumber(d.shibui)} (${(Math.abs(d.relDiff) * 100).toFixed(0)}%)`;
    if (d.level !== "fail") { warnings.push(`input check (Shibui, ${sc.asOf}): ${line}`); continue; }
    const o = overrides.get(d.field);
    if (o) warnings.push(`input check (Shibui, ${sc.asOf}): ${line} — override accepted for ${d.field}: ${o.reason} [verified against ${o.verifiedAgainst}, ${o.capturedAt.slice(0, 10)}]`);
    else errors.push(`input check (Shibui, ${sc.asOf}): ${line} — a fail blocks the build; verify the pack against the filing and record the verdict with: npm run facts:crosscheck -- <TICKER> <ACCESSION> --accept ${d.field} --reason "<why the pack is right>" --verified-against "<filing or source>"`);
  }
  return { blocked: errors.length > 0, errors, warnings };
}
