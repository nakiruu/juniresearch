import type { FactPack } from "./schema";
export interface ValidationIssue { field: string; message: string; value: unknown }
const sumShares = (xs: { share: number }[]) => xs.reduce((a, x) => a + x.share, 0);

export function validateFactPack(p: FactPack): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const years = p.statements.fiscalYears.map((l) => Number("20" + l.slice(2)));
  if (!years.every((y, i) => i === 0 || y === years[i - 1] + 1))
    issues.push({ field: "statements.fiscalYears", message: "must be five consecutive years, oldest first", value: p.statements.fiscalYears });
  for (const [name, table] of Object.entries({ income: p.statements.income, balance: p.statements.balance, cashflow: p.statements.cashflow }))
    for (const r of table) if (r.values.length !== 5) issues.push({ field: `statements.${name}.${r.key}`, message: "must have five values", value: r.values.length });
  const a = p.analysts;
  if (a.buy + a.hold + a.sell !== a.count) issues.push({ field: "analysts.count", message: "buy + hold + sell must equal count", value: a.count });
  const segSum = sumShares(p.segments.items);
  if (Math.abs(segSum - 1) > 0.02) issues.push({ field: "segments.items[].share", message: "shares must sum to 1 ± 0.02", value: segSum });
  const geoSum = sumShares(p.geoMix.items);
  if (p.geoMix.items.length && Math.abs(geoSum - 1) > 0.02) issues.push({ field: "geoMix.items[].share", message: "shares must sum to 1 ± 0.02 when present", value: geoSum });
  const h = p.history;
  const ascending = h.every((pt, i) => i === 0 || pt.date > h[i - 1].date);
  if (h.length < 20 || !ascending || (h.length > 0 && h[h.length - 1].date > p.capturedAt.slice(0, 10)))
    issues.push({ field: "history", message: "must be ≥ 20 points, strictly ascending, ending on or before capturedAt", value: { length: h.length, ascending, last: h.at(-1)?.date } });
  if (p.latestQuarter.periodEnd < p.filing.periodEnd)
    issues.push({ field: "latestQuarter.periodEnd", message: `must be on or after filing.periodEnd (${p.filing.periodEnd}) — an older quarter means stale vendor data`, value: p.latestQuarter.periodEnd });
  return issues;
}

export function assertValidFactPack(p: FactPack, label: string): void {
  const issues = validateFactPack(p);
  if (!issues.length) return;
  throw new Error(`Invalid FactPack ${label}:\n` + issues.map((i) => `  - ${i.field}: ${i.message} (received ${JSON.stringify(i.value)})`).join("\n"));
}
