/**
 * grounding.ts — "do not invent numbers", as a check rather than a promise.
 * ---------------------------------------------------------------------------
 * numericTokens() pulls every figure out of prose, typed: kind, currency,
 * magnitude after the scale, the sign written, resolution and significant
 * digits. buildGroundingIndex() types every figure on the surface the author
 * sees — the rendered Facts block (its tables by row format), the Calls, the
 * report's own calls and the Context — and no raw FactPack number. A prose
 * figure grounds only against an entry of a compatible kind, magnitude, sign
 * and precision. checkGrounding() reports each figure that matches nothing,
 * with the reason; weakGroundings() lists those only a unit-less context cell,
 * a rescaled money cell or unsigned context vouches for.
 */
import type { ValidationIssue } from "../validate";
import type { FinancialTable } from "../report.schema";
import { formatCell, type CellFormat } from "../format";
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
// a day range takes only a dash, after a capitalized month: "May 5–10" is a date; "May 5 to 20 analysts" and "it may 5 to 18" are not
const DAY_RANGE_BEFORE = new RegExp(`(^|[^A-Za-z])${MONTH}\\.? \\d{1,2}\\s?[-–—]\\s?$`);
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
  if (n >= 1 && n <= 31 && /(19|20)\d\d-(\d{1,2}-)?$/.test(text.slice(Math.max(0, start - 8), start))) return "other"; // 2026-08-30
  if (n >= 1 && n <= 31 && MONTH_BEFORE.test(before12)) return "other";               // December 31, August 30, 2026 ("450, 2026" is a figure)
  if (n >= 1 && n <= 31 && DAY_RANGE_BEFORE.test(text.slice(Math.max(0, start - 20), start))) return "other"; // September 22–23, May 5-10
  if (n >= 1 && n <= 31 && (/^\/\d{1,2}\/(19|20)\d\d(?!\d)/.test(after) || (/(^|[^\d/])\d{1,2}\/$/.test(text.slice(Math.max(0, start - 4), start)) && /^\/(19|20)\d\d(?!\d)/.test(after)))) return "other"; // 9/30/2026
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
    // "40%-50%", "1.5x-2.0x": a hyphen straight after a % or a multiple is a range dash, as an en dash would be, not a minus
    const prev = out.at(-1);
    const rangeDash = !open && sign1 === "-" && !!prev && prev.end === m.index && (prev.kind === "pct" || prev.kind === "mult");
    if (rangeDash) { raw = raw.slice(1); start += 1; }
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
    const sgnS = (rangeDash ? "" : sign1) || sign2;
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
    // "30.09.2026" reads as 30.09 then a year: a day-first dotted date, not a figure
    if (!cur && !scaleS && !unit && frac.length === 3 && Number(int) >= 1 && Number(int) <= 31 && /^\.(19|20)\d\d(?!\d)/.test(text.slice(end, end + 6))) t.allow = "other";
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

/* ------------------------------------------------------------- the surface index ------------------------------------------------------------- */

export type GroundingSource = "facts" | "calls" | "judgment" | "context";
export interface GroundingEntry extends NumberToken { source: GroundingSource }

/** What the author's prompt shows: the Facts block and the statement tables it renders, the Calls, the report's own calls, the Context. */
export interface GroundingSurface {
  tables: FinancialTable[];
  factsBlock: string;
  callsBlock: string;
  judgmentBlock: string;
  contextBlock: string;
}

const TABLE_KIND: Record<CellFormat, { kind: NumberKind; scale: number }> = {
  usdB: { kind: "money", scale: 1e9 }, usdT: { kind: "money", scale: 1e12 }, pct: { kind: "pct", scale: 1 }, pctSigned: { kind: "pct", scale: 1 },
  mult: { kind: "mult", scale: 1 }, eps: { kind: "money", scale: 1 }, num2: { kind: "plain", scale: 1 }, num1: { kind: "plain", scale: 1 },
  usd0: { kind: "money", scale: 1 }, usd2: { kind: "money", scale: 1 },
};

/** Statement-table cells: unit and scale come from the row's format, the digits from formatCell — exactly the cell the author sees. */
function tableEntries(tables: FinancialTable[]): GroundingEntry[] {
  const out: GroundingEntry[] = [];
  for (const t of tables) for (const r of t.rows) for (const v of r.values) {
    if (v == null) continue;
    if (typeof v === "string") { for (const tk of numericTokens(v, "index")) out.push({ ...tk, source: "facts", sign: tk.sign || 1 }); continue; }
    const s = formatCell(v, r.format);
    const { kind, scale } = TABLE_KIND[r.format];
    const mm = s.match(/^[+\-−]?\$?([\d,]+)(\.\d+)?/);
    if (!mm) continue;
    const precision = mm[2] ? mm[2].length - 1 : 0;
    const num = Number(mm[1].replace(/,/g, "") + (mm[2] ?? ""));
    const sign = v < 0 ? -1 : 1;
    out.push({ raw: s, index: 0, end: 0, kind, currency: kind === "money" ? "$" : null, value: sign * num, magnitude: sign * num * scale, abs: num * scale, sign,
      precision, scale, resolution: Math.pow(10, -precision) * scale, sig: sigDigits(mm[1], mm[2] ?? ""),
      tz: mm[2] ? 0 : (mm[1].replace(/,/g, "").match(/[1-9](0+)$/)?.[1].length ?? 0), source: "facts" });
  }
  return out;
}

/** Facts-block lines outside the tables. compactUSD/compactNum trim trailing zeros ("$27B" is 27.0 at 1 dp), so restore the formatter's precision. */
function factsLineEntries(factsBlock: string): GroundingEntry[] {
  const out: GroundingEntry[] = [];
  for (const line of factsBlock.split("\n")) {
    if (line.startsWith("|")) continue;
    for (const t of numericTokens(line, "index")) {
      const precision = t.scale >= 1e6 ? Math.max(t.precision, t.kind === "money" ? (t.scale === 1e12 ? 2 : 1) : 2) : t.precision;
      out.push({ ...t, precision, resolution: t.scale >= 1e6 ? Math.pow(10, -precision) * t.scale : t.resolution, source: "facts", sign: t.sign || 1 });
    }
  }
  return out;
}

/** Calls and judgment blocks are structured (sign known); context text is not (an unsigned "12%" may be a decline). */
function textEntries(text: string, source: GroundingSource): GroundingEntry[] {
  const out: GroundingEntry[] = [];
  for (const t of numericTokens(text, "index")) {
    out.push({ ...t, source, sign: source === "context" ? t.sign : (t.sign || 1) });
    // a "%" on the next line of a shredded table may belong to a column header, so the cell is also indexed bare
    if (source === "context" && t.kind === "pct" && /\n%$/.test(t.raw) && t.scale === 1) out.push({ ...t, kind: "plain", source });
  }
  return out;
}

/* ------------------------------------------------------------------ matching ------------------------------------------------------------------ */

export interface GroundingPolicy {
  ctxCoarsenSig: number;       // a prose figure may round a context figure only if it keeps ≥ this many significant digits
  surfCoarsenSig: number;      // ... a Facts/Calls/judgment figure: ≥ min(this, the source's own significant digits)
  wildMinSig: number;          // a bare context cell grounds a money or scaled figure only with ≥ this many significant digits
  wildMinSigPct: number;       // ... a % or points figure (single-digit change cells: "(4)", "<1", "0.5")
  checkSign: boolean;
  ppFromPct: boolean;          // "46.9 points" of growth grounded by a context "46.9%"
  multFromRatio: boolean;      // "17.26x current ratio" grounded by the Facts' "17.26"
  bands: boolean;              // "$190s"
  multWild: boolean;           // may a multiple ground against a bare context cell? (no: multiples are not table cells)
  secondReadingMinSig: number; // the trailing-zeros-insignificant reading only matches entries with ≥ this many significant digits
  bpFromPct: boolean;          // may basis points ground against a % level? (no: "540 bps" is a change, not a 5.4% level)
  perShareNoScaleUp: boolean;  // a 2-decimal context money cell ("$4.56", per-share-shaped) is never scaled up to millions or billions
}

/** The measured policy (plan 2026-10-07 §2–4). Not configurable: a looser policy is a reviewed code change. */
export const POLICY: Readonly<GroundingPolicy> = Object.freeze({
  ctxCoarsenSig: 3, surfCoarsenSig: 2, wildMinSig: 2, wildMinSigPct: 1, checkSign: true, ppFromPct: true, multFromRatio: true, bands: true,
  multWild: false, secondReadingMinSig: 2, bpFromPct: false, perShareNoScaleUp: true,
});

export type MatchClass = "exact" | "lossless" | "coarse" | "band" | "none";
export interface Grounding { ok: boolean; cls: MatchClass; by?: GroundingEntry }

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const roundAt = (x: number, res: number) => Math.round(x / res + 1e-9 * Math.max(1, Math.abs(x / res)));
const isBareCell = (e: GroundingEntry) => e.source === "context" && e.kind === "plain" && e.scale === 1;

function kindOk(p: NumberToken, e: GroundingEntry, pol: GroundingPolicy): boolean {
  switch (p.kind) {
    case "plain": return true;                                                        // a unitless prose number: any kind, by magnitude
    case "money": return (e.kind === "money" && e.currency === p.currency) || (e.source === "context" && e.kind === "plain" && e.scale >= 1e6); // never a Facts share count
    case "pct": return e.kind === "pct";
    case "mult": return e.kind === "mult" || (pol.multFromRatio && e.source === "facts" && e.kind === "plain" && e.precision > 0);
    case "pp": return e.kind === "pp" || e.kind === "bp" || (pol.ppFromPct && e.kind === "pct");
    case "bp": return e.kind === "pp" || e.kind === "bp" || (pol.bpFromPct && e.kind === "pct");
  }
}

/** Compare magnitudes under the resolution rule: never finer than the source; a lossy rounding keeps enough significant digits. */
function compare(p: NumberToken, eAbs: number, eRes: number, eSig: number, source: GroundingSource, pol: GroundingPolicy): MatchClass {
  if (p.band != null) return eAbs >= p.abs - 1e-9 && eAbs < p.abs + p.band - 1e-9 ? "band" : "none";
  if (p.resolution < eRes * (1 - 1e-9)) return "none";
  if (near(p.resolution, eRes)) return roundAt(p.abs, p.resolution) === roundAt(eAbs, p.resolution) ? "exact" : "none";
  if (roundAt(eAbs, p.resolution) !== roundAt(p.abs, p.resolution)) return "none";
  if (near(roundAt(eAbs, p.resolution) * p.resolution, eAbs)) return "lossless";       // "$495.00" → "$495", "$1,148 million" → "$1.148 billion"
  const floor = source === "context" ? pol.ctxCoarsenSig : Math.min(pol.surfCoarsenSig, eSig);
  return p.sig >= floor ? "coarse" : "none";
}

const RANK: Record<MatchClass, number> = { exact: 4, lossless: 3, band: 2, coarse: 1, none: 0 };
const best = (cs: MatchClass[]) => cs.reduce((a, c) => (RANK[c] > RANK[a] ? c : a), "none" as MatchClass);

function matchOne(p: NumberToken, e: GroundingEntry, pol: GroundingPolicy): MatchClass {
  if (p.band != null && !pol.bands) return "none";
  if (pol.checkSign && p.sign !== 0 && e.sign !== 0 && p.sign !== e.sign) return "none";
  // A bare context cell ("15,955" under "(in millions)", "27.3" under "Percent change"): unit and scale sit in a header the
  // tokenizer cannot see, so it grounds a prose figure of any kind at any table scale — if the prose figure is specific enough.
  if (isBareCell(e)) {
    if (p.kind === "plain" && p.scale === 1) return compare(p, e.abs, e.resolution, e.sig, e.source, pol);
    if (p.kind === "mult" && !pol.multWild) return "none";
    const floor = p.kind === "pct" || p.kind === "pp" || p.kind === "bp" ? pol.wildMinSigPct : pol.wildMinSig;
    if (p.sig < floor && p.band == null) return "none";
    const scales = p.kind === "money" || p.kind === "plain" ? [1, 1e3, 1e6, 1e9] : p.kind === "bp" ? [0.01] : [1];
    return best(scales.map((s) => compare(p, e.abs * s, e.resolution * s, e.sig, e.source, pol)));
  }
  // An unscaled money cell in context ("$\n15,955"): known kind, scale from a header.
  if (e.source === "context" && e.kind === "money" && e.scale === 1 && p.kind === "money" && e.currency === p.currency) {
    if (pol.perShareNoScaleUp && e.precision === 2 && p.scale !== 1) return compare(p, e.abs, e.resolution, e.sig, e.source, pol);
    return best([1, 1e3, 1e6, 1e9].map((s) => compare(p, e.abs * s, e.resolution * s, e.sig, e.source, pol)));
  }
  if (!kindOk(p, e, pol)) return "none";
  return compare(p, e.abs, e.resolution, e.sig, e.source, pol);
}

/** The readings of a prose figure: as written, and — for an integer with trailing zeros — with them insignificant. */
function readings(p: NumberToken): NumberToken[] {
  if (!p.tz || p.band != null) return [p];
  return [p, { ...p, resolution: p.resolution * Math.pow(10, p.tz), sig: Math.max(1, p.sig - p.tz) }];
}

function grounds(p0: NumberToken, entries: readonly GroundingEntry[], pol: GroundingPolicy): Grounding {
  let r: { cls: MatchClass; by?: GroundingEntry } = { cls: "none" };
  readings(p0).forEach((p, i) => {
    for (const e of entries) {
      // the second reading only matches an entry with ≥ 2 significant digits: a 1-digit $B Facts cell ("0.3")
      // would otherwise vouch for every "$300 million"
      if (i === 1 && e.sig < pol.secondReadingMinSig) continue;
      const c = matchOne(p, e, pol);
      if (RANK[c] > RANK[r.cls]) r = { cls: c, by: e };
      if (r.cls === "exact") break;
    }
  });
  return { ok: r.cls !== "none", ...r };
}

/* ---------------------------------------------------------------- diagnostics ---------------------------------------------------------------- */

export type MissReason = "sign" | "finer" | "rounding" | "short-cell" | "unit" | "none";
export type Weakness = "bare-cell" | "money-cell-scale-up" | "unsigned-context";

/** Why a figure missed: the first single relaxation under which it would ground. */
function explain(p: NumberToken, entries: readonly GroundingEntry[]): { reason: MissReason; by?: GroundingEntry } {
  let g = grounds(p, entries, { ...POLICY, checkSign: false });
  if (g.ok) return { reason: "sign", by: g.by };
  // finer than the surface: the prose rounded to a non-zero entry's resolution equals the entry
  for (const e of entries) {
    if (isBareCell(e) && p.kind !== "plain") continue;
    if (!(e.kind === p.kind || p.kind === "plain") || (p.kind === "money" && e.currency !== p.currency)) continue;
    if (e.abs !== 0 && p.resolution < e.resolution * (1 - 1e-9) && roundAt(p.abs, e.resolution) === roundAt(e.abs, e.resolution)) return { reason: "finer", by: e };
  }
  g = grounds(p, entries, { ...POLICY, surfCoarsenSig: 1, ctxCoarsenSig: 1 });
  if (g.ok) return { reason: "rounding", by: g.by };
  g = grounds(p, entries, { ...POLICY, wildMinSig: 1, wildMinSigPct: 1, perShareNoScaleUp: false });
  if (g.ok) return { reason: "short-cell", by: g.by };
  // the same written digits at the same precision under another unit or scale, on a typed entry (a bare cell has no unit to differ);
  // across kinds only for a specific figure (≥ 3 significant digits), never a coincidental "14"
  for (const e of entries) {
    if (isBareCell(e) || e.precision !== p.precision || !near(Math.abs(e.value), Math.abs(p.value))) continue;
    if ((e.kind === p.kind && e.scale !== p.scale) || (e.kind !== p.kind && p.kind !== "plain" && p.sig >= 3)) return { reason: "unit", by: e };
  }
  return { reason: "none" };
}

/** A grounded figure is weak when it grounds only through a path that cannot check its unit, scale or sign. */
function weakness(p: NumberToken, entries: readonly GroundingEntry[]): Weakness | null {
  if (!grounds(p, entries, POLICY).ok) return null;
  const noBare = entries.filter((e) => !(isBareCell(e) && !(p.kind === "plain" && p.scale === 1)));
  if (!grounds(p, noBare, POLICY).ok) return "bare-cell";
  const noScaleUp = noBare.filter((e) => !(e.source === "context" && e.kind === "money" && e.scale === 1 && p.scale !== 1));
  if (!grounds(p, noScaleUp, POLICY).ok) return "money-cell-scale-up";
  if (p.sign !== 0 && !grounds(p, noScaleUp.filter((e) => !(e.source === "context" && e.sign === 0)), POLICY).ok) return "unsigned-context";
  return null;
}

/** Every figure on the grounding surface, typed. */
export class GroundingIndex {
  constructor(readonly entries: readonly GroundingEntry[]) {}
  /** Whether a prose figure grounds, how, and against which entry. */
  lookup(t: NumberToken): Grounding { return grounds(t, this.entries, POLICY); }
  explain(t: NumberToken): { reason: MissReason; by?: GroundingEntry } { return explain(t, this.entries); }
  weakness(t: NumberToken): Weakness | null { return weakness(t, this.entries); }
}

export function buildGroundingIndex(s: GroundingSurface): GroundingIndex {
  return new GroundingIndex([
    ...tableEntries(s.tables), ...factsLineEntries(s.factsBlock),
    ...textEntries(s.callsBlock, "calls"), ...textEntries(s.judgmentBlock, "judgment"), ...textEntries(s.contextBlock, "context"),
  ]);
}

/* ------------------------------------------------------------------ checks ------------------------------------------------------------------ */

export interface GroundingMiss extends ValidationIssue { token: NumberToken; reason: MissReason; by?: GroundingEntry }
export interface WeakGrounding { field: string; raw: string; weakness: Weakness; by?: GroundingEntry }

const SOURCE_NAME: Record<GroundingSource, string> = { facts: "Facts", calls: "Calls", judgment: "judgment", context: "Context" };
const shown = (e: GroundingEntry) => `${SOURCE_NAME[e.source]} "${e.raw.replace(/\s+/g, " ")}"`;
function reasonText(reason: MissReason, by?: GroundingEntry): string {
  switch (reason) {
    case "sign": return `the surface shows it with the opposite sign: ${shown(by!)}`;
    case "finer": return `more precise than the surface shows: ${shown(by!)}`;
    case "rounding": return `rounding ${shown(by!)} this far is not allowed — quote it as shown or in words`;
    case "short-cell": return "a table cell this short cannot vouch for a scaled figure — quote it with the table's unit or in words";
    case "unit": return `the surface shows these digits with another unit or scale: ${shown(by!)}`;
    case "none": return "no figure of this kind on the surface matches it";
  }
}

/** Grounded figures that only a unit-less cell, a scaled-up money cell or unsigned context vouches for — the reviewer checks these first. */
export function weakGroundings(obj: unknown, index: GroundingIndex): WeakGrounding[] {
  const out: WeakGrounding[] = [];
  for (const { path, text } of stringLeaves(obj))
    for (const tok of numericTokens(text)) {
      const w = index.weakness(tok);
      if (w) out.push({ field: path, raw: tok.raw, weakness: w, by: index.lookup(tok).by });
    }
  return out;
}

const WEAK_PATH: Record<Weakness, string> = {
  "bare-cell": "a unit-less table cell", "money-cell-scale-up": "a money cell read at another scale", "unsigned-context": "an unsigned context figure",
};
/** One line of the errors file's weak block and the review brief's list. */
export const weakLine = (w: WeakGrounding) => `${w.field}: "${w.raw.replace(/\s+/g, " ")}" grounds only through ${WEAK_PATH[w.weakness]}${w.by ? `: ${shown(w.by)}` : ""}`;

/** Each prose figure that grounds against nothing on the surface, with the reason it missed. */
export function checkGrounding(obj: unknown, index: GroundingIndex): GroundingMiss[] {
  const misses: GroundingMiss[] = [];
  for (const { path, text } of stringLeaves(obj))
    for (const tok of numericTokens(text)) {
      if (index.lookup(tok).ok) continue;
      const { reason, by } = index.explain(tok);
      misses.push({ field: path, message: `"${tok.raw}" is not in the facts or the captured context — ${reasonText(reason, by)}`, value: tok.raw, token: tok, reason, by });
    }
  return misses;
}
