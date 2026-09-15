/**
 * statement-values.ts — shared statement-row lookup and null-safe ratio helper.
 * -----------------------------------------------------------------------------
 * Both project.ts (five-year table rows, YoY, margins) and highlights.ts (latest-FY
 * highlight cells) read a FactPack's statement rows and divide two possibly-null
 * figures the same way; this is the one place that logic lives.
 */
import type { FactPack } from "./schema";

/** The full five-year values array for a statement row, or five nulls if the row is missing. */
export function statementValues(p: FactPack, table: "income" | "balance" | "cashflow", key: string): (number | null)[] {
  return p.statements[table].find((r) => r.key === key)?.values ?? [null, null, null, null, null];
}

/** The latest fiscal year's value for a statement row, or null if the row or year is missing. */
export function latestStatementValue(p: FactPack, table: "income" | "balance" | "cashflow", key: string): number | null {
  return statementValues(p, table, key).at(-1) ?? null;
}

/** Null-safe division: null if either side is null or the denominator is zero. */
export function safeDiv(a: number | null, b: number | null): number | null {
  return a == null || b == null || b === 0 ? null : a / b;
}
