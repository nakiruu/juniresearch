/**
 * grounding.ts — "do not invent numbers", as a check rather than a promise.
 * ---------------------------------------------------------------------------
 * numericTokens() pulls every figure out of prose. buildAllowedIndex() collects
 * every number a report may legitimately contain: FactPack values at their
 * display scalings, the rendered facts block, and the captured context text.
 * checkGrounding() reports each prose figure that matches nothing.
 */
import type { FactPack } from "../facts/schema";
import type { ValidationIssue } from "../validate";
import { stringLeaves } from "./walk";

export interface NumberToken {
  raw: string;
  value: number;      // as written, sign applied: "$29.6B" → 29.6
  magnitude: number;  // with the multiplier: "$29.6B" → 2.96e10; "86%" → 86
  precision: number;  // decimals written
  kind: "money" | "pct" | "mult" | "plain";
}

const MULT: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12, thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };

// Lookbehind: not preceded by letter, straight or curly apostrophe, $, digit, or period. Prevents Q3'26 → "26" leak.
// Capture groups: (1) sign [+\-−], (2) $, (3) integer with thousands-separators or bare, (4) decimals,
// (5) scaled unit (K/M/B/T or spelled-out), (6) percent sign, (7) x multiplier.
const TOKEN = /(?<![A-Za-z'’$\d.])([+\-−]?)(\$?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(K|M|B|T|thousand|million|billion|trillion)(?![A-Za-z])|(%)|(x)(?![A-Za-z]))?/g;
const YEAR = /^(199\d|20[0-3]\d|2040)$/;

/** Figures that never need grounding: small counts, years, fiscal/quarter labels, dates, form names, ratios like 10:1, period phrases like 52-week. */
function allowListed(m: RegExpExecArray, text: string): boolean {
  const [whole, , dollar, int, frac, suffix, pctSign, xSign] = m;
  const bare = !dollar && !frac && !suffix && !pctSign && !xSign;
  const n = Number(int.replace(/,/g, ""));
  const before = text.slice(Math.max(0, m.index - 3), m.index);
  const after = text.slice(m.index + whole.length, m.index + whole.length + 8);
  if (/(^|[^A-Za-z])(Q|FY)$/.test(before) || /^'?\d{2}\b/.test(after) && /Q$/.test(before)) return true; // Q3'26, FY24, FY2026
  if (bare && n <= 12) return true;
  if (bare && YEAR.test(int)) return true;
  if (bare && /^-[QK]\b/.test(after)) return true;                          // 10-Q, 10-K
  if (bare && /^:\d/.test(after)) return true;                              // 10:1
  if (bare && /^-(week|month|day|year|quarter)s?\b/i.test(after)) return true; // 52-week, 12-month, 90-day, 5-year
  if (/^,? ?(19|20)\d\d\b/.test(after)) return true;         // "August 30, 2026", "30 2026"
  if (bare && n >= 1 && n <= 31 && /(19|20)\d\d-(\d{1,2}-)?$/.test(text.slice(Math.max(0, m.index - 8), m.index))) return true; // ISO date component, e.g. 2026-08-30
  return false;
}

export function numericTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text))) {
    const [raw, sign, dollar, int, frac = "", suffix, pctSign, xSign] = m;
    if (allowListed(m, text)) continue;
    const abs = Number(int.replace(/,/g, "") + frac);
    const value = /[-−]/.test(sign) ? -abs : abs;
    const mult = suffix ? MULT[suffix.toLowerCase()] : 1;
    const kind: NumberToken["kind"] = dollar ? "money" : pctSign ? "pct" : xSign ? "mult" : "plain";
    out.push({ raw: raw.trim(), value, magnitude: value * mult, precision: frac ? frac.length - 1 : 0, kind });
  }
  return out;
}

const roundTo = (x: number, dp: number) => Number(x.toFixed(dp));

export class AllowedIndex {
  private values: number[] = [];
  add(v: number): void { if (Number.isFinite(v)) this.values.push(v); }
  addToken(t: NumberToken): void { this.add(t.value); this.add(t.magnitude); this.add(Math.abs(t.value)); this.add(Math.abs(t.magnitude)); }
  /**
   * A prose figure is grounded if some indexed value rounds to it at the figure's own precision.
   * No relative tolerance: a 0.5% band let unrelated numbers vouch for each other (EPS 1.23 ×100 for "123.4x").
   */
  has(t: NumberToken): boolean {
    const targets = [t.value, t.magnitude, Math.abs(t.value), Math.abs(t.magnitude)];
    return this.values.some((v) => targets.some((x) => roundTo(v, t.precision) === roundTo(x, t.precision)));
  }
}

/** Every number in the FactPack, at the scalings the page and the prose use. */
function factNumbers(pack: FactPack): number[] {
  const out: number[] = [];
  const visit = (v: unknown): void => {
    if (typeof v === "number") out.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit({ quote: pack.quote, statements: pack.statements, latestQuarter: pack.latestQuarter, ttm: pack.ttm,
          estimates: pack.estimates, analysts: pack.analysts, segments: pack.segments, geoMix: pack.geoMix, peers: pack.peers });
  return out;
}

export function buildAllowedIndex(pack: FactPack, extraText: string[]): AllowedIndex {
  const index = new AllowedIndex();
  for (const n of factNumbers(pack)) {
    index.add(n);
    if (Math.abs(n) >= 1e6) for (const d of [1e3, 1e6, 1e9, 1e12]) index.add(n / d);
    if (Math.abs(n) < 50) index.add(n * 100);            // ratios as percentages
  }
  const c = pack.context;
  const texts = [c.description.text, c.mdaExcerpt?.text, c.riskFactorsExcerpt?.text, c.pressRelease?.text, c.proxyStatement?.text, c.transcriptHighlights?.text,
                 ...c.headlines.map((h) => h.text), ...extraText].filter((t): t is string => typeof t === "string");
  for (const t of texts) for (const tok of numericTokens(t)) index.addToken(tok);
  return index;
}

export function checkGrounding(obj: unknown, index: AllowedIndex): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const { path, text } of stringLeaves(obj))
    for (const tok of numericTokens(text))
      if (!index.has(tok))
        issues.push({ field: path, message: `"${tok.raw}" is not in the facts or the captured context`, value: tok.raw });
  return issues;
}
