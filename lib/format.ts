/**
 * format.ts — ALL presentation of numbers lives here.
 * -----------------------------------------------------------------------------
 * The JSON contract carries raw numbers (361.99, 0.408, 1.72e12). Nothing in the
 * data is pre-formatted. Every "$", "x", "%", "B/T", "~" and "+/-" is applied
 * here, so a single sidecar renders consistently in any theme or medium (web/PDF).
 *
 * Convention: every percentage in the contract is a DECIMAL RATIO.
 *   40.8% -> 0.408      -3.3% -> -0.033      +221% -> 2.21      30% -> 0.30
 */

export const num = (x: number, dp = 1): string =>
  x.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** Trim a trailing ".0" / redundant zeros from a fixed-decimal string. */
const trimZeros = (s: string): string =>
  s.includes(".") ? s.replace(/\.?0+$/, "") : s;

/* --------------------------------- scalars --------------------------------- */

/** Small dollar amount: 361.99 -> "$361.99". */
export const usd = (x: number, dp = 2): string => "$" + num(x, dp);

/** Auto-scaled dollars: 1.72e12 -> "$1.72T", 63.9e9 -> "$63.9B", 58e9 -> "$58B", -55.7e9 -> "-$55.7B" (sign before "$"). */
export function compactUSD(x: number, opts: { approx?: boolean } = {}): string {
  const p = opts.approx ? "~" : "";
  const sign = x < 0 ? "-" : "";
  const a = Math.abs(x);
  if (a >= 1e12) return `${p}${sign}$${trimZeros(num(a / 1e12, 2))}T`;
  if (a >= 1e9) return `${p}${sign}$${trimZeros(num(a / 1e9, 1))}B`;
  if (a >= 1e6) return `${p}${sign}$${trimZeros(num(a / 1e6, 1))}M`;
  return `${p}${sign}$${num(a, 2)}`;
}

/** Auto-scaled bare count (e.g. shares): 4.76e9 -> "4.76B". */
export function compactNum(x: number, opts: { approx?: boolean } = {}): string {
  const p = opts.approx ? "~" : "";
  const a = Math.abs(x);
  if (a >= 1e12) return `${p}${trimZeros(num(x / 1e12, 2))}T`;
  if (a >= 1e9) return `${p}${trimZeros(num(x / 1e9, 2))}B`;
  if (a >= 1e6) return `${p}${trimZeros(num(x / 1e6, 2))}M`;
  return `${p}${num(x, 0)}`;
}

/** Valuation multiple: 44.9 -> "44.9x". */
export const mult = (x: number, dp = 1): string => `${num(x, dp)}x`;

/** Percent from a ratio: 0.408 -> "40.8%", signed 0.216 -> "+21.6%". */
export function pct(x: number, opts: { signed?: boolean; dp?: number } = {}): string {
  const dp = opts.dp ?? 1;
  const sign = opts.signed && x >= 0 ? "+" : "";
  return `${sign}${num(x * 100, dp)}%`;
}

/* ------------------------------ table cells ------------------------------- */
/**
 * A financial-table cell is `number | string | null`.
 *   number -> formatted per the row's `format`
 *   null   -> em dash ("—")
 *   string -> rendered verbatim (escape hatch for indicative values like "~40x")
 */
export type Cell = number | string | null;
export type CellFormat =
  | "usdB"   // absolute USD shown in billions, no symbol (header carries "($B)"): 63.9e9 -> "63.9"
  | "usdT"   // absolute USD in trillions, no symbol
  | "pct"    // ratio -> "61.4%"
  | "pctSigned" // ratio -> "+20.9%" / "—" handled by null
  | "mult"   // "44.9x"
  | "eps"    // 4.77 -> "4.77"
  | "num2"   // 2.64
  | "num1"   // 20.0
  | "usd0"   // "$600"
  | "usd2";  // "$180.00"

export function formatCell(v: Cell, fmt: CellFormat): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  switch (fmt) {
    case "usdB": return num(v / 1e9, 1);
    case "usdT": return num(v / 1e12, 2);
    case "pct": return pct(v);
    case "pctSigned": return pct(v, { signed: true });
    case "mult": return mult(v);
    case "eps": return num(v, 2);
    case "num2": return num(v, 2);
    case "usd0": return usd(v, 0);
    case "usd2": return usd(v, 2);
    case "num1":
    default: return num(v, 1);
  }
}

/* ----------------------------- snapshot cells ----------------------------- */
export type SnapshotUnit = "usd" | "usdLarge" | "mult" | "pct" | "shares";
export interface SnapshotCell {
  label: string;
  value?: number;
  unit?: SnapshotUnit;
  approx?: boolean;
  dp?: number;        // decimals for the base value
  change?: number;    // appended as " (+X%)" from a ratio
  changeDp?: number;  // decimals for the change (default 1)
  note?: string;      // appended as " (note)" e.g. "record", "guided"
  raw?: string;       // escape hatch for composite/text cells (ranges, "Buy (54 B / 6 H / 0 S)")
}

export function formatSnapshot(c: SnapshotCell): string {
  let base = "";
  if (c.raw != null) {
    base = c.raw;
  } else {
    const v = c.value ?? 0;
    switch (c.unit) {
      case "usd": base = usd(v, c.dp ?? 2); break;
      case "usdLarge": base = compactUSD(v, { approx: c.approx }); break;
      case "mult": base = (c.approx ? "~" : "") + mult(v, c.dp ?? 1); break;
      case "pct": base = pct(v, { dp: c.dp ?? 1 }); break;
      case "shares": base = compactNum(v, { approx: c.approx }); break;
      default: base = String(v);
    }
  }
  if (c.change != null) base += ` (${pct(c.change, { signed: true, dp: c.changeDp ?? 1 })})`;
  if (c.note) base += ` (${c.note})`;
  return base;
}

/* ----------------------- derived values (project-owned) -------------------- */
/**
 * These are recomputed from base numbers so every report is internally
 * consistent and arithmetically correct regardless of what the model emits.
 * The model never sends an upside %, a weighted scenario value, or a fair value.
 */

/** Upside of a target vs the current price, as a ratio: (target/current - 1). */
export const upside = (target: number, current: number): number => target / current - 1;

/** "Price Target: $440.00 – $525.00" */
export const priceTargetLine = (lo: number, hi: number): string =>
  `Price Target: ${usd(lo)} – ${usd(hi)}`;

/** "+21.6% to +45.0%" from a target range vs current. */
export const upsideRangeText = (lo: number, hi: number, current: number): string =>
  `${pct(upside(lo, current), { signed: true })} to ${pct(upside(hi, current), { signed: true })}`;

export interface ScenarioIn { name: string; driver: string; impliedPrice: number; probability: number; }
export interface ScenarioComputed extends ScenarioIn { weighted: number; }

/** Adds probability-weighted contribution to each scenario and the summed fair value. */
export function computeScenarios(scenarios: ScenarioIn[]): {
  rows: ScenarioComputed[];
  fairValue: number;
} {
  const rows = scenarios.map((s) => ({ ...s, weighted: s.impliedPrice * s.probability }));
  const fairValue = rows.reduce((a, r) => a + r.weighted, 0);
  return { rows, fairValue };
}
