/**
 * intrinsic.ts — the intrinsic-value / market-implied-expectations engine.
 * -----------------------------------------------------------------------------
 * A reverse DCF: instead of asserting a growth rate and comparing the value to
 * price, it takes the price as given and solves for the owner-earnings growth
 * the market is already paying for, then compares that to what five years of
 * statements say is achievable. The gap (implied − achievable) is the signal,
 * and the same model, run forward at a bear/base/bull growth, yields a fair-value
 * range that plugs straight into conviction.ts as mechanical scenarios. This
 * grounds E instead of leaving it to three free-hand analyst numbers.
 * See docs/scoreconcepts/4.md.
 *
 * Prototype scope: the discount rate is exogenous (a cost of equity from moat.ts).
 * Owner earnings is trailing FCF (fcfYield × marketCap) charged for stock-based compensation: the
 * TTM SBC from the Shibui cross-check when the base is TTM FCF, else the latest fiscal-year SBC (8.md).
 * The pack's inputs are guarded against that independent source: a > 25% disagreement on market cap,
 * shares or TTM FCF abstains (inputCheckFailures); a smaller one is flagged.
 *
 * Growth is a STARTING rate that fades linearly to terminal over the explicit stage (dcfEquityValue),
 * so both the market-implied and the achievable growth mean "year-1 growth", not a decade-flat rate.
 * Achievable growth guards against tiny FCF base years and spin-off revenue breaks and is capped at
 * +15% (achievableGrowthDetail); names whose owner earnings are under 1.5% of market cap abstain.
 */
import type { ScenarioIn } from "../format";
import { classifySector } from "./gates";

interface Row {
  key: string;
  label: string;
  values: (number | null)[];
}

/** The slice of a FactPack the engine reads — any full FactPack satisfies it structurally. */
export interface IntrinsicFacts {
  ticker?: string;
  sector?: string;
  sic?: number | null;
  sbc?: (number | null)[]; // stock-based compensation per fiscal year, aligned to statements.fiscalYears
  quote: { price: number; marketCap: number; sharesOutstanding: number };
  ttm: { fcfYield: number | null };
  statements: { fiscalYears: string[]; income: Row[]; cashflow: Row[] };
  /** Independent cross-check of the pack's inputs against Shibui Finance (stamped by lib/facts; optional). */
  shibuiCheck?: ShibuiCheck;
}

/** Structural mirror of the FactPack's `shibuiCheck` stamp (not imported from lib/facts on purpose). */
export interface ShibuiCheck {
  asOf: string;
  quarterEnd: string | null;
  price: number | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  revenueQuarter: number | null;
  fcfTtm: number | null;
  sbcTtm: number | null; // TTM SBC over the 4 Shibui quarters ending at quarterEnd
  diffs: ShibuiDiff[];
  source: "shibui";
}
export interface ShibuiDiff {
  field: "price" | "marketCap" | "sharesOutstanding" | "revenueQuarter" | "fcfTtm";
  pack: number;
  shibui: number;
  relDiff: number; // fraction: ok ≤ 0.10, warn ≤ 0.25, fail > 0.25
  level: "ok" | "warn" | "fail";
}

/** The inputs the DCF is linear in: a "fail" on any of these abstains (dcfApplicable). */
export const GUARDED_INPUTS: readonly ShibuiDiff["field"][] = ["marketCap", "sharesOutstanding", "fcfTtm"];

/** Compact number for a one-line message: 1.23B, 845M, 12.5K, 104.2. */
export const compactNumber = (x: number): string => {
  const a = Math.abs(x);
  const [d, u] = a >= 1e12 ? [1e12, "T"] : a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : a >= 1e3 ? [1e3, "K"] : [1, ""];
  return `${Number((x / d).toPrecision(3))}${u}`;
};
const pct = (relDiff: number) => `${(Math.abs(relDiff) * 100).toFixed(0)}%`;

/**
 * The Shibui diffs that abstain the DCF: level "fail" (> 25%) on market cap, shares outstanding or TTM
 * FCF — fair value is linear in each, so a base that an independent source puts > 25% elsewhere is not
 * a base to value. Empty when the pack carries no check. Pure; scripts print it.
 */
export function inputCheckFailures(f: Pick<IntrinsicFacts, "shibuiCheck">): ShibuiDiff[] {
  return (f.shibuiCheck?.diffs ?? []).filter((d) => d.level === "fail" && GUARDED_INPUTS.includes(d.field));
}

/** The abstention reason for inputCheckFailures, or null when there are none. */
export function inputCheckReason(f: Pick<IntrinsicFacts, "shibuiCheck">): string | null {
  const fails = inputCheckFailures(f);
  if (!fails.length) return null;
  const parts = fails.map((d) => `${d.field} ${compactNumber(d.pack)} vs ${compactNumber(d.shibui)} (${pct(d.relDiff)})`);
  return `inputs disagree with an independent source (Shibui): ${parts.join("; ")}`;
}

/** Diffs that are flagged but do not abstain: any non-ok level other than a guarded-input fail. */
export function inputCheckWarnings(f: Pick<IntrinsicFacts, "shibuiCheck">): ShibuiDiff[] {
  return (f.shibuiCheck?.diffs ?? []).filter((d) => d.level !== "ok" && !(d.level === "fail" && GUARDED_INPUTS.includes(d.field)));
}

/** A compact status for preview tables: "—" (no check), "ok", "warn: shares", "FAIL: fcf, warn: price". */
export function inputCheckStatus(f: Pick<IntrinsicFacts, "shibuiCheck">): string {
  const c = f.shibuiCheck;
  if (!c) return "—";
  const short: Record<ShibuiDiff["field"], string> = { price: "price", marketCap: "cap", sharesOutstanding: "shares", revenueQuarter: "rev", fcfTtm: "fcf" };
  const of = (lvl: ShibuiDiff["level"]) => c.diffs.filter((d) => d.level === lvl).map((d) => short[d.field]);
  const fails = of("fail"), warns = of("warn");
  const parts = [...(fails.length ? [`FAIL: ${fails.join(",")}`] : []), ...(warns.length ? [`warn: ${warns.join(",")}`] : [])];
  return parts.length ? parts.join("; ") : "ok";
}

/** Achievable growth ceiling: a decade-sustainable STARTING rate (4.md §5; was +20% before the fade). */
export const GROWTH_CAP = 0.15;
/** Achievable growth floor: a structural decliner is valued at a decline, but not an unbounded one. */
export const GROWTH_FLOOR = -0.1;
/** The FCF CAGR is trusted only when the first-year FCF is at least this share of the last year's. */
export const FCF_BASE_MIN_RATIO = 0.25;
/** A year-over-year revenue drop beyond this is read as a portfolio change (spin-off / divestiture). */
export const REVENUE_BREAK_DROP = 0.2;
/** Owner earnings below this share of market cap are too small a base to value (value is linear in it). */
export const MIN_OWNER_EARNINGS_YIELD = 0.015;
/**
 * The discount rate is floored at terminal growth + this spread. Value scales with 1/(r − gt), so a
 * low-beta name's cost of equity (AT&T ~6%) sat under 3pt above the 3% terminal and the terminal value
 * dominated: one point of r moved the median margin of safety ~11pt. Robustness corners and the
 * implied-growth band may sit one point lower (never closer than 3pt to gt).
 */
export const MIN_DISCOUNT_SPREAD = 0.04;
/** The implied-growth solver's search band; a solution at either edge is reported, not trusted. */
export const IMPLIED_GROWTH_BAND: readonly [number, number] = [-0.5, 2.0];

/**
 * A reverse DCF only makes sense for a mature, FCF-generative operating company.
 * It abstains for financials and utilities (no simple FCF stream to value), for
 * any name with non-positive owner earnings (pre-/negative-FCF), where the model
 * has no meaningful solution, and for owner earnings below 1.5% of market cap:
 * fair value is linear in the base, so a base that is rounding noise (INTC at
 * 0.08% of market cap) would print a −100% margin of safety. See 4.md §11. It also abstains when an
 * independent source (Shibui) puts market cap, shares or TTM FCF more than 25% away from the pack's
 * (inputCheckFailures).
 */
export function dcfApplicable(f: IntrinsicFacts): { ok: boolean; reason: string | null } {
  const sector = classifySector(f);
  if (sector !== "industrial") return { ok: false, reason: `${sector}: no FCF stream to value by DCF` };
  const disagree = inputCheckReason(f);
  if (disagree) return { ok: false, reason: disagree };
  const oe = ownerEarningsBase(f);
  if (oe <= 0) return { ok: false, reason: "non-positive owner earnings (pre-/negative-FCF)" };
  const cap = f.quote.marketCap;
  if (num(cap) && cap > 0 && oe < MIN_OWNER_EARNINGS_YIELD * cap)
    return { ok: false, reason: "owner earnings below 1.5% of market cap — too small a base to value" };
  return { ok: true, reason: null };
}

export interface IntrinsicConfig {
  r: number; // discount rate / cost of equity (exogenous)
  terminalGrowth: number;
  horizon: number; // explicit-stage years
}

export interface IntrinsicResult {
  ownerEarnings: number;
  impliedGrowth: number; // market-implied STARTING growth (year 1), faded linearly to terminal by year N
  impliedGrowthBand: [number, number, number]; // at r−2% (never below gt + 3pt), r, r+2%
  achievableGrowth: number;
  gap: number; // impliedGrowth − achievableGrowth (the signal)
  fairValue: { bear: number; base: number; bull: number }; // per share
  eMechanical: number; // probability-weighted fair value / price − 1 (the model's E, vs the Street's)
  marginOfSafety: number; // base/price − 1 (negative = paying above the base case)
  /**
   * Robustness band on the margin of safety: min / max over the centre point and the four corners
   * {r − 1pt, r + 1pt} × {base growth − 2pt, base growth + 2pt}. The shifted growth is NOT re-clamped
   * to the cap/floor; the terminal-≤-explicit rule still applies. The r − 1pt corner never goes
   * below gt + 3pt (MIN_DISCOUNT_SPREAD − 1pt). mosRange.max < 0 means the price
   * sits above fair value under every nearby assumption (a robust disagreement).
   */
  mosRange: { min: number; max: number };
  scenarios: ScenarioIn[]; // fed into computeConviction()
  discountRate: number; // the rate actually used: the cost of equity, floored at gt + MIN_DISCOUNT_SPREAD
  flags: string[];
}

const num = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);
const series = (section: Row[], key: string) => section.find((r) => r.key === key)?.values;

/**
 * Year-t growth of the linear fade: g in year 1, declining linearly to gt by year N,
 * i.e. g + (gt − g)·(t − 1)/(N − 1). With N ≤ 1 the single explicit year grows at g.
 */
export const fadedGrowth = (g: number, gt: number, t: number, N: number): number =>
  N <= 1 ? g : g + ((gt - g) * (t - 1)) / (N - 1);

/**
 * Two-stage FCFE with a linear fade: owner earnings grow at the STARTING rate g in year 1, the rate
 * fades linearly to gt by year N (fadedGrowth), then grows at gt forever; all discounted at r. So `g`
 * is a starting growth, not a decade-flat one — a hypergrowth rate is not compounded for ten years.
 * The caller passes the terminal it wants faded toward: intrinsicRead passes min(gt, max(g, 0)), so a
 * decliner fades toward 0 rather than toward +3%.
 */
export function dcfEquityValue(oe0: number, g: number, r: number, gt: number, N: number): number {
  let v = 0;
  let f = oe0;
  for (let t = 1; t <= N; t++) {
    f *= 1 + fadedGrowth(g, gt, t, N);
    v += f / (1 + r) ** t;
  }
  const terminal = (f * (1 + gt)) / (r - gt) / (1 + r) ** N;
  return v + terminal;
}

export const fairValuePerShare = (oe0: number, g: number, shares: number, r: number, gt: number, N: number): number =>
  dcfEquityValue(oe0, g, r, gt, N) / shares;

/**
 * Solve for the STARTING growth (year 1, faded linearly to gt by year N — see dcfEquityValue) that
 * makes the model equal the market's equity value. Because the rate fades, the starting growth a
 * price implies is further from gt than the old decade-flat equivalent, so the search band is widened
 * to [−50%, +200%] (the old [−10%, +80%] band pinned cheap names such as T and FOUR at −10%).
 */
export function impliedGrowth(oe0: number, equityValue: number, r: number, gt: number, N: number): number {
  let [lo, hi] = IMPLIED_GROWTH_BAND;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (dcfEquityValue(oe0, mid, r, gt, N) > equityValue) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export interface OwnerEarningsDetail {
  oe: number; // owner earnings after SBC
  fcf: number; // the FCF base before SBC
  fcfBasis: "ttm" | "fiscalYear" | "none"; // fcfYield × marketCap, the latest non-null FCF row, or neither
  fcfYear: string | null; // on the fiscal-year path, the year whose FCF was used
  sbc: number | null; // the SBC charged (null = none isolated)
  sbcSource: "ttmShibui" | "fiscalYearSec" | null;
}

/**
 * Trailing owner earnings — fcfYield × marketCap (fallback: the latest FCF row), then charged for
 * stock-based compensation. GAAP adds SBC back to cash flow because it is non-cash, but it dilutes
 * owners as surely as a buyback, so a true owner-earnings figure expenses it (Damodaran; 8.md).
 * Which SBC is matched to the period of the FCF base:
 *  - TTM FCF base: the Shibui TTM SBC (shibuiCheck.sbcTtm, finite ≥ 0) when present, else the latest
 *    fiscal-year SEC SBC (a timing mismatch, but the best available).
 *  - Fiscal-year FCF base: the latest fiscal-year SEC SBC (same period).
 *  - Either base with no SEC SBC at all: the Shibui TTM SBC when present (BE, CVX, XOM, CBRS).
 * A no-op when neither is known.
 */
export function ownerEarningsDetail(f: IntrinsicFacts): OwnerEarningsDetail {
  const y = f.ttm.fcfYield;
  let fcf: number;
  let fcfBasis: OwnerEarningsDetail["fcfBasis"];
  let fcfIndex: number | null = null;
  if (num(y) && num(f.quote.marketCap)) {
    fcf = y * f.quote.marketCap;
    fcfBasis = "ttm";
  } else {
    // The most recent fiscal year that HAS an FCF value (a null latest column must not read as zero).
    const row = series(f.statements.cashflow, "freeCashFlow") ?? [];
    let i = row.length - 1;
    while (i >= 0 && !num(row[i])) i--;
    fcf = i >= 0 ? (row[i] as number) : 0;
    fcfBasis = i >= 0 ? "fiscalYear" : "none";
    fcfIndex = i >= 0 ? i : null;
  }
  // On the fiscal-year path, pair the FCF with the same year's SEC SBC.
  const sbcFy = fcfIndex != null && f.sbc?.length === f.statements.fiscalYears.length ? f.sbc[fcfIndex] : f.sbc?.[f.sbc.length - 1];
  const ttmRaw = f.shibuiCheck?.sbcTtm;
  const sbcTtm = num(ttmRaw) && ttmRaw >= 0 ? ttmRaw : null;
  let sbc: number | null = null;
  let sbcSource: OwnerEarningsDetail["sbcSource"] = null;
  if (sbcTtm != null && (fcfBasis === "ttm" || !num(sbcFy))) {
    sbc = sbcTtm;
    sbcSource = "ttmShibui";
  } else if (num(sbcFy)) {
    sbc = sbcFy;
    sbcSource = "fiscalYearSec";
  }
  const fcfYear = fcfIndex != null ? f.statements.fiscalYears[fcfIndex] ?? null : null;
  return { oe: sbc != null ? fcf - sbc : fcf, fcf, fcfBasis, fcfYear, sbc, sbcSource };
}

/** Trailing owner earnings after SBC — see ownerEarningsDetail for which FCF and SBC are used. */
export const ownerEarningsBase = (f: IntrinsicFacts): number => ownerEarningsDetail(f).oe;

/**
 * Index of the year a portfolio change starts (spin-off / divestiture): the LAST year whose revenue
 * fell more than 20% from the prior year; −1 when there is none. Pure and null-tolerant (a pair with a
 * missing or non-positive prior year is skipped). The latest break is used because only the years
 * after it describe the business as it now stands.
 */
export function revenueBreakIndex(revenue: (number | null)[] | undefined): number {
  if (!revenue) return -1;
  let idx = -1;
  for (let t = 1; t < revenue.length; t++) {
    const prev = revenue[t - 1];
    const cur = revenue[t];
    if (num(prev) && num(cur) && prev > 0 && cur / prev - 1 < -REVENUE_BREAK_DROP) idx = t;
  }
  return idx;
}

const cagr = (vals: (number | null)[] | undefined): number | null => {
  if (!vals || vals.length < 2) return null;
  const first = vals[0];
  const last = vals[vals.length - 1];
  if (!num(first) || !num(last) || first <= 0 || last <= 0) return null;
  return (last / first) ** (1 / (vals.length - 1)) - 1;
};

export interface AchievableGrowthDetail {
  g: number; // clamped to [GROWTH_FLOOR, GROWTH_CAP]
  source: "fcf" | "revenue" | "none";
  breakIndex: number; // revenueBreakIndex over the statements, −1 = none
  capped: boolean; // the unclamped rate sat above GROWTH_CAP
  flags: string[];
}

/**
 * A disciplined achievable (starting) growth from the statements, clamped to [−10%, +15%]:
 *  1. Structural break — a year-over-year revenue drop of more than 20% is a portfolio change (DD's
 *     Qnity spin, MMM's Solventum spin), not organic decline: both CAGRs use only the years from the
 *     break onward. With fewer than 2 growth years left, the revenue change over what remains is used
 *     (0 when there is none), and a flag says so.
 *  2. Meaningful base — the FCF CAGR is used only when both endpoints are positive and the first is at
 *     least 25% of the last (CHWY's $8.6M → $560M is not a growth rate); otherwise revenue CAGR.
 *  3. Sign rule — a negative FCF CAGR does not override a non-negative revenue CAGR (a lumpy FCF
 *     endpoint must not turn a growing business into a decliner, LH); when both are negative the less
 *     negative wins.
 *  4. Clamp to [−10%, +15%]. It is NOT floored at a positive number: a structurally declining business
 *     must value at a decline. The ceiling is a STARTING rate; dcfEquityValue fades it to terminal.
 */
export function achievableGrowthDetail(f: IntrinsicFacts): AchievableGrowthDetail {
  const flags: string[] = [];
  const rev = series(f.statements.income, "revenue");
  const fcf = series(f.statements.cashflow, "freeCashFlow");
  const br = revenueBreakIndex(rev);
  const revW = rev?.slice(Math.max(0, br));
  const fcfW = fcf?.slice(Math.max(0, br));
  if (br >= 0)
    flags.push(`revenue structural break at ${f.statements.fiscalYears[br] ?? `year ${br}`} (>20% drop: spin-off/divestiture); growth measured from the break onward`);

  let raw: number;
  let source: AchievableGrowthDetail["source"];
  const years = (revW?.length ?? 0) - 1; // growth intervals in the window
  if (br >= 0 && years < 2) {
    const revG = cagr(revW);
    raw = revG ?? 0;
    source = revG != null ? "revenue" : "none";
    flags.push(`fewer than 2 post-break years: growth ${revG != null ? "from the post-break revenue change" : "set to 0"}`);
  } else {
    const first = fcfW?.[0];
    const last = fcfW?.[fcfW.length - 1];
    const bothPositive = num(first) && num(last) && first > 0 && last > 0;
    const fcfG = bothPositive && first >= FCF_BASE_MIN_RATIO * last ? cagr(fcfW) : null;
    if (bothPositive && fcfG == null) flags.push("FCF base year below 25% of the latest: revenue CAGR used");
    const revG = cagr(revW);
    if (fcfG != null && revG != null && fcfG < 0) {
      // A lumpy FCF endpoint must not override the revenue trend: a grower stays a grower, and of two
      // declines the less negative wins.
      raw = revG >= 0 ? revG : Math.max(fcfG, revG);
      source = raw === fcfG ? "fcf" : "revenue";
    } else if (fcfG != null) {
      raw = fcfG;
      source = "fcf";
    } else {
      raw = revG ?? 0;
      source = revG != null ? "revenue" : "none";
    }
  }
  const capped = raw > GROWTH_CAP;
  if (capped) flags.push(`achievable growth capped at +${(GROWTH_CAP * 100).toFixed(0)}% (raw ${(raw * 100).toFixed(0)}%)`);
  return { g: Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, raw)), source, breakIndex: br, capped, flags };
}

/** The achievable starting growth — see achievableGrowthDetail for the rules. */
export const achievableGrowth = (f: IntrinsicFacts): number => achievableGrowthDetail(f).g;

export function intrinsicRead(f: IntrinsicFacts, cfg: IntrinsicConfig): IntrinsicResult {
  const { terminalGrowth: gt, horizon: N } = cfg;
  const r = Math.max(cfg.r, gt + MIN_DISCOUNT_SPREAD);
  const rNear = (x: number) => Math.max(x, gt + MIN_DISCOUNT_SPREAD - 0.01); // corners / band
  const oed = ownerEarningsDetail(f);
  const oe0 = oed.oe;
  const equity = f.quote.marketCap;
  const shares = f.quote.sharesOutstanding;
  const price = f.quote.price;
  const sbcFlag =
    oed.sbcSource === "ttmShibui" ? "TTM SBC (Shibui) charged to owner earnings"
    : oed.sbcSource === "fiscalYearSec" ? "fiscal-year SBC (SEC) charged to owner earnings"
    : "trailing-FCF owner-earnings proxy (SBC not isolated)";
  const flags: string[] = [sbcFlag, "exogenous discount rate"];
  const lastFy = f.statements.fiscalYears[f.statements.fiscalYears.length - 1];
  if (oed.fcfBasis === "fiscalYear") flags.push(`owner earnings from ${oed.fcfYear} FCF (no TTM)${oed.fcfYear !== lastFy ? ` — ${lastFy} FCF missing` : ""}`);
  for (const d of inputCheckWarnings(f)) flags.push(`input check (Shibui): ${d.field} differs by ${pct(d.relDiff)}`);

  if (r > cfg.r) flags.push(`discount rate floored at ${(r * 100).toFixed(1)}% (cost of equity ${(cfg.r * 100).toFixed(1)}%)`);
  const gImpl = impliedGrowth(oe0, equity, r, gt, N);
  if (gImpl - IMPLIED_GROWTH_BAND[0] < 1e-3 || IMPLIED_GROWTH_BAND[1] - gImpl < 1e-3)
    flags.push(`market-implied growth is outside the solver band [${IMPLIED_GROWTH_BAND.map((b) => `${b * 100}%`).join(", ")}] — implied growth and bull/bear are unreliable`);
  const ach = achievableGrowthDetail(f);
  const gAch = ach.g;
  flags.push(...ach.flags);
  if (gAch < 0) flags.push("declining base case (terminal growth capped at the explicit rate)");
  // Terminal growth must not exceed the explicit-stage growth: a business shrinking at −2% is not
  // assumed to grow at +3% in perpetuity. A no-op for growers (gAch > gt); it deflates a decliner.
  // The explicit stage fades linearly from g toward that same terminal (dcfEquityValue), so a
  // decliner fades toward 0 and a grower toward gt. Value stays monotone in g, so the scenario
  // ordering below survives the fade.
  const fvAt = (g: number, rr: number) => fairValuePerShare(oe0, g, shares, rr, Math.min(gt, Math.max(g, 0)), N);
  const fv = (g: number) => fvAt(g, r);

  // The Base case is the achievable path and carries the 0.50 weight — always, regardless of
  // price ordering. Bear (implied halved, a cyclical air-pocket) and Bull (near the market-implied
  // rate) are then bounded to sit a real spread below / above the base, so bull >= base >= bear is
  // guaranteed without a price sort reassigning the probabilities (docs/scoreconcepts/7.md C1).
  const spread = Math.max(0.03, Math.abs(gImpl - gAch) / 2);
  const bearG = Math.min(gImpl / 2, gAch - spread);
  const baseG = gAch;
  const bullG = Math.max(gImpl * 0.9, gAch + spread);
  const drv = (g: number) => `owner-earnings growth ~${(g * 100).toFixed(0)}%/yr`;
  const scenarios: ScenarioIn[] = [
    { name: "Bull", driver: drv(bullG), impliedPrice: fv(bullG), probability: 0.25 },
    { name: "Base", driver: drv(baseG), impliedPrice: fv(baseG), probability: 0.5 },
    { name: "Bear", driver: drv(bearG), impliedPrice: fv(bearG), probability: 0.25 },
  ];
  const bear = { g: bearG, price: fv(bearG) }, base = { g: baseG, price: fv(baseG) }, bull = { g: bullG, price: fv(bullG) };
  // Robustness band: centre + the four {r ± 1pt} × {base g ± 2pt} corners (growth shifted unclamped).
  const mosGrid = [base.price / price - 1];
  for (const dr of [-0.01, 0.01]) for (const dg of [-0.02, 0.02]) mosGrid.push(fvAt(baseG + dg, rNear(r + dr)) / price - 1);
  const mosRange = { min: Math.min(...mosGrid), max: Math.max(...mosGrid) };

  return {
    ownerEarnings: oe0,
    impliedGrowth: gImpl,
    impliedGrowthBand: [
      impliedGrowth(oe0, equity, rNear(r - 0.02), gt, N),
      gImpl,
      impliedGrowth(oe0, equity, r + 0.02, gt, N),
    ],
    achievableGrowth: gAch,
    gap: gImpl - gAch,
    fairValue: { bear: bear.price, base: base.price, bull: bull.price },
    eMechanical: scenarios.reduce((a, s) => a + s.probability * s.impliedPrice, 0) / price - 1,
    marginOfSafety: base.price / price - 1,
    mosRange,
    scenarios,
    discountRate: r,
    flags,
  };
}
