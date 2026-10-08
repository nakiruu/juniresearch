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

export type NumberKind = "money" | "pct" | "mult" | "pp" | "bp" | "plain";

export interface NumberToken {
  raw: string;
  value: number;      // as written, sign applied: "$29.6B" → 29.6
  magnitude: number;  // with the scale, sign applied: "$29.6B" → 2.96e10; "86%" → 86; "40 bps" → 0.4 (bp in points)
  precision: number;  // decimals written
  kind: NumberKind;
  currency: string | null; // money only: "$" (also US$), "C$", "A$", "HK$", "€", "£", "¥"
  sign: -1 | 0 | 1;   // the sign written ("+", "-", "−", "(12.3)%"); 0 when none is
  abs: number;        // |magnitude|
  scale: number;      // the suffix's multiplier: "B" → 1e9
  resolution: number; // 10^-precision × scale (bp in points)
  sig: number;        // significant digits written
  tz: number;         // an integer's trailing zeros: "$500 million" → 2
  band?: number;      // "$190s" → 10: the band [abs, abs + band)
  index: number;      // offsets of the token in the text
  end: number;
}

type Draft = Omit<NumberToken, "value" | "magnitude"> & { num: number; allow?: "small" | "other" };

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, tn: 1e12, trillion: 1e12 };
const CURRENCY: Record<string, string> = { "US$": "$", "$": "$", "C$": "C$", "A$": "A$", "HK$": "HK$", "€": "€", "£": "£", "¥": "¥" };

// Lookbehind: not preceded by a letter, an apostrophe, a currency, a digit or a period (Q3'26 must not leak "26").
// Groups: (1) "(" (2) sign (3) currency (4) sign after the currency ("$-0.08") (5) integer (6) decimals
// (7) leading-dot decimals (".07") (8) ")" (9) scale (10) "%"/x/× (11) unit-word separator (12) unit word (13) decade "s".
// Lowercase k/m/b are a scale only straight after a currency ("$5m"); "12.3k" stays 12.3.
const TOKEN = new RegExp(
  String.raw`(?<![A-Za-z'’$€£¥\d.])(\()?([+\-−]?)(US\$|C\$|A\$|HK\$|\$|€|£|¥)?(?:(?<=[$€£¥])[ \n])?([+\-−]?)(?:(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?|(?<=[$\s(])(\.\d+))(\))?` +
  String.raw`(?:((?:[ -]?(?:thousand|million|billion|trillion))|(?: ?(?:K|M|B|T|bn|mn|mm|tn))|(?:(?<=[$€£¥][ \n]?[+\-−]?[\d.,]+) ?(?:k|m|b)))(?![A-Za-z]))?` +
  String.raw`(?:([ \n]?%|[xX](?![A-Za-z])|×)|([\s-]?)(percentage[ -]points?|percent|per cent|ppts?|pp|pts?|points?|bps|bp|basis points?|times)(?![A-Za-z])|(s)(?![A-Za-z]))?`, "g");
const YEAR = /^(199\d|20[0-3]\d|2040)$/;
const MONTH = "(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|June?|July?|Aug(ust)?|Sept?(ember)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)";
const MONTH_BEFORE = new RegExp(`(^|[^A-Za-z])${MONTH}\\.? $`, "i");
const MONTH_AFTER = new RegExp(`^ ${MONTH}\\b`);
const INDEX_BEFORE = /(^|[^A-Za-z])(S&P|Russell|Nasdaq|NASDAQ|Dow Jones|FTSE|STOXX|Stoxx|MSCI|Nikkei|Fortune|Global) ?$/;
const LABEL_BEFORE = /(^|[^A-Za-z])(Note|Notes|Item|Items|Tier|Section|Rule|Phase|Schedule|Form|Class|Series|Level|Title|Chapter|Part|Article|ISO|Gen|Proposal|Exhibit|Regulation|Stage|Version|PDK|No\.|#)\s?$/;
const PERIOD_BEFORE = /(^|[^A-Za-z])(past|last|trailing|prior|next|previous|over the) $/i;

function unitKind(u: string | undefined): NumberKind | null {
  if (!u) return null;
  const s = u.trim().toLowerCase();
  if (s === "%" || s === "percent" || s === "per cent") return "pct";
  if (s === "x" || s === "×" || s === "times") return "mult";
  if (/^percentage[ -]point/.test(s) || s === "pp" || s.startsWith("ppt") || s === "pts" || s === "pt" || s.startsWith("point")) return "pp";
  if (s === "bps" || s === "bp" || s.startsWith("basis point")) return "bp";
  return null;
}

/**
 * Bare integers that never need grounding: small counts, years, fiscal/quarter labels, dates, form names,
 * ratios like 10:1, period phrases like 52-week. "small" (≤ 12) is a prose-only rule — the index keeps small
 * numbers — and the only kind a range may revive ("5 to 7 percent"); "other" never joins a range.
 */
function allowed(text: string, start: number, end: number, int: string): false | "small" | "other" {
  const n = Number(int.replace(/,/g, ""));
  const before3 = text.slice(Math.max(0, start - 3), start);
  const before12 = text.slice(Math.max(0, start - 12), start);
  const after = text.slice(end, end + 12);
  if (/(^|[^A-Za-z])(Q|FY)$/.test(before3) || (/^'?\d{2}\b/.test(after) && /Q$/.test(before3))) return "other"; // Q3'26, FY24
  if (YEAR.test(int)) return "other";
  if (/^-[QK]\b/.test(after)) return "other";                                         // 10-Q, 10-K
  if (/^:\d/.test(after)) return "other";                                             // 10:1
  if (/^-(week|month|day|year|quarter)s?\b/i.test(after)) return "other";             // 52-week
  if (/^,? ?(19|20)\d\d\b/.test(after)) return "other";                               // August 30, 2026
  if (n >= 1 && n <= 31 && /(19|20)\d\d-(\d{1,2}-)?$/.test(text.slice(Math.max(0, start - 8), start))) return "other"; // 2026-08-30
  if (n >= 1 && n <= 31 && MONTH_BEFORE.test(before12)) return "other";               // December 31
  if (n >= 1 && n <= 31 && MONTH_AFTER.test(after)) return "other";                   // 30 September 2026
  if (LABEL_BEFORE.test(before12)) return "other";                                    // Note 14, Item 1A, Tier 1, Section 232, Phase 3
  if (/[A-Za-z]-$/.test(text.slice(Math.max(0, start - 2), start))) return "other";   // FAST-41, COVID-19
  if (/^[A-Z](\/A)?(?![A-Za-z])/.test(after) && !/^[KMBT](?![A-Za-z])/.test(after)) return "other"; // 14A, 13G, 13G/A, 1A, 3D
  if (/^\/\d+-(week|month|day|year)/.test(after)) return "other";                     // 52/53-week
  if (INDEX_BEFORE.test(before12)) return "other";                                   // S&P 500, Russell 2000, Fortune 500
  if (/^\(k\)/i.test(after)) return "other";                                         // 401(k)
  if (n === 24 && /^\/7\b/.test(after)) return "other";                            // 24/7
  if (PERIOD_BEFORE.test(before12) && /^ (weeks|months|days|quarters)\b/.test(after)) return "other"; // the past 52 weeks
  return n <= 12 ? "small" : false;
}

const sigDigits = (int: string, frac: string) => Math.max(1, (int.replace(/,/g, "") + frac.replace(".", "")).replace(/^0+/, "").length);
const bpNorm = (kind: NumberKind) => (kind === "bp" ? 0.01 : 1);

/**
 * Every figure in the text, typed: kind, currency, absolute magnitude after the scale, the sign written,
 * resolution and significant digits. "index" mode (source text) keeps small counts; "prose" drops them.
 */
export function numericTokens(text: string, mode: "prose" | "index" = "prose"): NumberToken[] {
  const out: Draft[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text))) {
    const [whole, open, sign1, cur, sign2, intRaw, fracRaw, dotFrac, close, scaleRaw, unitA, unitSep, unitWRaw, decade] = m;
    const int = intRaw ?? "0";
    const frac = fracRaw ?? dotFrac ?? "";
    let unitW: string | undefined = unitWRaw;
    const paren = !!open && !!close;
    let raw = whole, start = m.index;
    if (open && !close) { raw = raw.slice(1); start += 1; }
    if (close && !open) raw = raw.replace(/\)(?=[^)]*$)/, "");
    const scaleS = scaleRaw?.replace(/^[ -]/, "");
    // "February 17, 2026 point to" is a year, not 2,026 points; "met 4 times" is a count, not a multiple;
    // a hyphenated unit word is a unit only as "-percentage-point" ("a 10-point plan" is not 10 points)
    if (unitW && !frac && !cur && !scaleS && (YEAR.test(int) || (unitW === "times" && Number(int) <= 12))) unitW = undefined;
    if (unitW && unitSep === "-" && !/^percentage/i.test(unitW)) unitW = undefined;
    const dropped = unitWRaw && !unitW ? (unitSep ?? "").length + unitWRaw.length : 0;
    if (dropped) raw = raw.slice(0, raw.length - dropped);
    const unit = unitA ?? unitW;
    let kind: NumberKind = cur ? "money" : unitKind(unit) ?? "plain";
    if (cur && unitKind(unit) === "pct") kind = "pct";
    const end = m.index + whole.length - dropped;
    const bare = !cur && !frac && !scaleS && !unit;
    const why = bare ? allowed(text, start, end, int) : false;
    const sgnS = sign1 || sign2;
    // sign: explicit +/- (before or after the currency), or "(12.3)%"; "($24.99)" in prose is a parenthetical
    const sign: -1 | 0 | 1 = /[-−]/.test(sgnS) ? -1 : sgnS === "+" ? 1 : paren && unit?.trim() === "%" ? -1 : 0;
    const scale = scaleS ? SCALE[scaleS.toLowerCase()] : 1;
    const precision = frac ? frac.length - 1 : 0;
    // an integer's trailing zeros are ambiguous ("$500 million" may mean ±$0.5M or ±$50M); the matcher tries both readings
    const tz = frac ? 0 : (int.replace(/,/g, "").match(/[1-9](0+)$/)?.[1].length ?? 0);
    const num = Number(int.replace(/,/g, "") + frac);
    const t: Draft = { raw: raw.trim(), index: start, end, kind, currency: kind === "money" ? CURRENCY[cur ?? "$"] : null, num,
      abs: num * scale * bpNorm(kind), sign, precision, scale, tz, resolution: Math.pow(10, -precision) * scale * bpNorm(kind), sig: sigDigits(int, frac) };
    if (decade && !frac && !scaleS && !unit) {
      if (YEAR.test(int)) t.allow = "other";                                          // the 1990s
      else t.band = Math.pow(10, (int.match(/0*$/)?.[0].length ?? 0)) * scale;       // $190s → [190, 200)
    }
    if (why && !(why === "small" && mode === "index") && !t.band) t.allow = why;
    out.push(t);
  }
  inherit(text, out);
  return out.filter((t) => !t.allow).map((d) => {
    const { num, ...t } = d;
    delete t.allow;
    const s = t.sign < 0 ? -1 : 1;
    return { ...t, value: s * num, magnitude: s * t.abs };
  });
}

/** "40-50%", "$1.2–1.5B", "5 to 7 percent", "$350–600", "$415 to $455 million": a bare end inherits the other end's unit, scale and currency. */
function inherit(text: string, ts: Draft[]): void {
  for (let i = 0; i + 1 < ts.length; i++) {
    const a = ts[i], b = ts[i + 1];
    const gap = text.slice(a.end, b.index);
    // "and" joins a range only after "between": "between $8.15 and $8.25 billion"
    const between = /^ and $/.test(gap) && /\bbetween $/i.test(text.slice(Math.max(0, a.index - 8), a.index));
    if (!/^\s?(?:[-–—]|to)\s?$/.test(gap) && !between) continue;
    if (a.allow === "other" || b.allow === "other") continue;          // a year, date, form or label never joins a range
    const aBare = a.kind === "plain" && a.scale === 1, bBare = b.kind === "plain" && b.scale === 1;
    const set = (t: Draft, kind: NumberKind, currency: string | null, scale: number) => {
      t.kind = kind; t.currency = currency; t.scale = scale;
      t.abs = t.num * scale * bpNorm(kind); t.resolution = Math.pow(10, -t.precision) * scale * bpNorm(kind); delete t.allow;
    };
    if (aBare && b.kind !== "plain") set(a, b.kind, b.currency, b.scale);                                        // 40-50%, 300-400 basis points
    else if (aBare && !bBare && b.kind === "plain") set(a, "plain", null, b.scale);                              // 1.2-1.5 million
    else if (a.kind === "money" && bBare && !b.allow && /^\s?[-–—]\s?$/.test(gap)) set(b, "money", a.currency, 1); // $350–600
    else if (a.kind === "money" && a.scale === 1 && b.kind === "plain" && b.scale !== 1) { set(a, "money", a.currency, b.scale); set(b, "money", a.currency, b.scale); } // $1.2–1.5B
    else if (a.kind === "money" && a.scale === 1 && b.kind === "money" && b.scale !== 1) set(a, "money", a.currency, b.scale); // $1.750 to $1.810 billion
  }
}

const roundTo = (x: number, dp: number) => Number(x.toFixed(dp));

export class AllowedIndex {
  private values: number[] = [];
  /** precision → every indexed value rounded to it; built on first lookup at that precision, kept current by add(). */
  private rounded = new Map<number, Set<number>>();
  add(v: number): void {
    if (!Number.isFinite(v)) return;
    this.values.push(v);
    for (const [dp, set] of this.rounded) set.add(roundTo(v, dp));
  }
  addToken(t: NumberToken): void { this.add(t.value); this.add(t.magnitude); this.add(Math.abs(t.value)); this.add(Math.abs(t.magnitude)); }
  /**
   * A prose figure is grounded if some indexed value rounds to it at the figure's own precision.
   * No relative tolerance: a 0.5% band let unrelated numbers vouch for each other (EPS 1.23 ×100 for "123.4x").
   * Rounded values are finite, so Set membership is exactly the `===` comparison it replaces.
   */
  has(t: NumberToken): boolean {
    if (!this.values.length) return false;
    const dp = t.precision;
    let set = this.rounded.get(dp);
    if (!set) {
      set = new Set(this.values.map((v) => roundTo(v, dp)));
      this.rounded.set(dp, set);
    }
    const targets = [t.value, t.magnitude, Math.abs(t.value), Math.abs(t.magnitude)];
    return targets.some((x) => set.has(roundTo(x, dp)));
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
