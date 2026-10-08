import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack } from "@/lib/facts/schema";
import { Desk } from "@/lib/synth/desk.schema";
import { canon, reviewInputs, inputsUnder, changedComponents, LEGACY_ENVELOPE_CALLS } from "@/lib/synth/review-inputs";
import { projectReportFacts } from "@/lib/facts/project";
import { HIGHLIGHT_KEYS } from "@/lib/facts/highlights";
import { renderFactsBlock, renderContextBlock, renderCalls } from "@/lib/synth/prompt";

const FIX = "lib/__fixtures__/review-inputs";
const loadPack = (t: string) => FactPack.parse(JSON.parse(readFileSync(`${FIX}/${t}.pack.json`, "utf8")));
const desk = Desk.parse(JSON.parse(readFileSync(`${FIX}/desk.json`, "utf8")));
const TICKERS = ["AVGO", "JPM", "UEC"] as const;

describe("canon", () => {
  it("is independent of key order", () => expect(canon({ b: 1, a: { d: 2, c: 3 } })).toBe(canon({ a: { c: 3, d: 2 }, b: 1 })));
  it("maps -0 to 0", () => expect(canon(-0)).toBe(canon(0)));
  it("absorbs float noise below 12 significant digits", () => expect(canon(0.1 + 0.2)).toBe(canon(0.3)));
  it("keeps a difference at display precision", () => expect(canon(0.3001)).not.toBe(canon(0.3)));
  it("drops undefined keys", () => expect(canon({ a: 1, b: undefined })).toBe(canon({ a: 1 })));
  it("throws on NaN and ±Infinity instead of hashing them as null", () => {
    for (const x of [NaN, Infinity, -Infinity]) {
      expect(() => canon(x)).toThrow(/non-finite/);
      expect(() => canon({ a: [1, x] })).toThrow(/non-finite/);
    }
  });
  it("hashes a sparse array's holes as null, as JSON does", () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(canon([1, , 3])).toBe("[1,null,3]");
    expect(canon([1, undefined, 3])).toBe("[1,null,3]");
  });
});

describe("reviewInputs: one mutation moves only its component", () => {
  const pack = loadPack("AVGO");
  const base = reviewInputs(pack, desk);
  const moved = (p: FactPack, d = desk) => changedComponents(base, reviewInputs(p, d));
  it("a TTM ratio moves facts", () => { const p = structuredClone(pack); p.ttm.netMargin = (p.ttm.netMargin ?? 0) + 0.01; expect(moved(p)).toEqual(["facts"]); });
  it("a close on the report's chart moves facts", () => { const p = structuredClone(pack); p.history[p.history.length - 1].close += 1; expect(moved(p)).toEqual(["facts"]); });
  it("one proxy word moves context", () => {
    const p = structuredClone(pack);
    p.context.proxyStatement = { ...(p.context.proxyStatement ?? { source: "edgar", asOf: "2026-01-01", text: "" }), text: (p.context.proxyStatement?.text ?? "") + " the" };
    expect(moved(p)).toEqual(["context"]);
  });
  it("the bear floor moves calls", () => expect(moved(pack, { ...desk, rating: { ...desk.rating, bearFloor: desk.rating.bearFloor + 0.01 } })).toEqual(["calls"]));
  it("unrendered pack fields move nothing", () => {
    const p = structuredClone(pack) as FactPack & Record<string, unknown>;
    p.capturedAt = "2030-01-01T00:00:00Z"; p.provenance = []; delete p.shibuiCheck; delete p.beta; delete p.sbc; delete p.goodwill;
    expect(moved(p)).toEqual([]);
  });
  it("a new recurring trap moves nothing", () => expect(moved(pack, { ...desk, recurringTraps: [...desk.recurringTraps, "new trap"] })).toEqual([]));
});

describe("inputsUnder", () => {
  it("scheme 1 is reviewInputs", () => expect(inputsUnder(1, loadPack("JPM"), desk)).toEqual(reviewInputs(loadPack("JPM"), desk)));
  it("an unknown scheme throws", () => expect(() => inputsUnder(2, loadPack("JPM"), desk)).toThrow(/scheme 2/));
});

describe("LEGACY_ENVELOPE_CALLS", () => {
  it("never equals a real calls hash", () => {
    for (const t of TICKERS) expect(reviewInputs(loadPack(t), desk).calls).not.toBe(LEGACY_ENVELOPE_CALLS);
    expect(LEGACY_ENVELOPE_CALLS).toMatch(/^[0-9a-f]{64}$/);
  });
});

/**
 * Scheme-1 pins on frozen byte copies of three packs and the desk. A failure means a projection, formatter-input or
 * schema change moved a value reviewers saw. Read the review-inputs.ts header before touching these: fix the change,
 * or accept it (update the pins, run grounding:sweep, list the reports whose reviews go stale in the commit message),
 * or move the picks to scheme 2.
 */
describe("scheme-1 pins", () => {
  const PINS: Record<(typeof TICKERS)[number], { facts: string; calls: string; context: string }> = {
    AVGO: {
      facts: "1735570636dc2b0222bd97fae02fae055bed1a8ccac333a8d4112759efde0d7b",
      calls: "652ab6e8d7a3925f2a5cd0ac2f1331a34831ddc06ba00db697e59a58e6cebb0c",
      context: "1461e75d0d6f74b4276eaa2f10e635c092965588df05fad5d7a53b523cfb9bbb",
    },
    JPM: {
      facts: "9d72403cb7bd97fca4e1fdf6275366bed3176bd9673e9f348202f3d061f42438",
      calls: "652ab6e8d7a3925f2a5cd0ac2f1331a34831ddc06ba00db697e59a58e6cebb0c",
      context: "9a56e8ee2d9b2631efb21ff926d298ac754b570366e898d8eee299034538cb85",
    },
    UEC: {
      facts: "6eda01b06a9b316a98b067d2a0978031e298742d16255fa405ab2b05a1ee9a3c",
      calls: "652ab6e8d7a3925f2a5cd0ac2f1331a34831ddc06ba00db697e59a58e6cebb0c",
      context: "66239698dab7104857e3f0f46a63dfddb71fcc832294e6917df9b7ad8cd7bb19",
    },
  };
  for (const t of TICKERS) it(`${t}`, () => expect(reviewInputs(loadPack(t), desk)).toEqual({ scheme: 1, ...PINS[t] }));
});

// ---- Completeness: every field the renderers read moves its component (Task 2). Over-sensitivity is allowed.

type Path = (string | number)[];
const GAP = "renderer reads a field the fingerprint does not cover: add it under a new scheme (see review-inputs.ts header)";
function leaves(o: unknown, path: Path = [], out: { path: Path; value: unknown }[] = []) {
  if (o !== null && typeof o === "object") {
    if (Array.isArray(o)) o.forEach((v, i) => leaves(v, [...path, i], out));
    else for (const [k, v] of Object.entries(o)) leaves(v, [...path, k], out);
  } else out.push({ path, value: o });
  return out;
}
type Tree = Record<string | number, unknown>;
const getAt = (o: unknown, path: Path) => path.reduce<unknown>((x, k) => (x == null ? undefined : (x as Tree)[k]), o);
const setAt = (o: unknown, path: Path, v: unknown) => {
  const parent = getAt(o, path.slice(0, -1)) as Tree;
  if (v === undefined) delete parent[path.at(-1)!]; else parent[path.at(-1)!] = v;
};
const bump = (v: unknown): unknown =>
  typeof v === "number" ? (v === 0 ? 1.5 : v * 1.37 + 0.11)
    : typeof v === "string" ? (/^\d{4}-\d{2}-\d{2}/.test(v) ? "2001-02-03" : v + " Zq")
      : typeof v === "boolean" ? !v : v === null ? 7.25 : v;

/** Rendered blocks and components for a pack; null when the projection rejects the mutated pack. */
function observe(p: FactPack) {
  try {
    const f = projectReportFacts(p);
    const i = reviewInputs(p, desk, f);
    return { factsBlock: renderFactsBlock(f, p), contextBlock: renderContextBlock(p), facts: i.facts, context: i.context };
  } catch { return null; }
}
/** The gaps between two packs: a rendered block that moved while its component did not. */
function gaps(a: FactPack, b: FactPack, label: string): string[] {
  const x = observe(a), y = observe(b);
  if (!x || !y) return [];
  const out: string[] = [];
  if (x.factsBlock !== y.factsBlock && x.facts === y.facts) out.push(`facts ${label}`);
  if (x.contextBlock !== y.contextBlock && x.context === y.context) out.push(`context ${label}`);
  return out;
}

describe("completeness (a): every present pack leaf", () => {
  for (const t of TICKERS)
    it(`${t}: a mutated leaf that moves the Facts or Context block moves its component`, () => {
      const pack = loadPack(t);
      const ls = leaves(pack).filter((l) => l.path[0] !== "history" || (l.path[1] as number) < 3);
      const found: string[] = [];
      let tested = 0;
      for (const l of ls) {
        const p = structuredClone(pack);
        setAt(p, l.path, bump(l.value));
        if (observe(p)) tested++;
        found.push(...gaps(pack, p, l.path.join(".")));
      }
      expect(tested).toBeGreaterThan(ls.length * 0.9);
      expect(found, GAP).toEqual([]);
    });

  it("every desk.rating leaf that moves the Calls block moves calls", () => {
    const pack = loadPack("AVGO");
    const base = reviewInputs(pack, desk).calls;
    const found: string[] = [];
    for (const l of leaves(desk.rating)) {
      const rating = structuredClone(desk.rating);
      setAt(rating, l.path, bump(l.value));
      if (renderCalls(rating) !== renderCalls(desk.rating) && reviewInputs(pack, { rating }).calls === base) found.push(`calls rating.${l.path.join(".")}`);
    }
    expect(found, GAP).toEqual([]);
  });
});

describe("completeness (b): every optional or nullable field, absent and present", () => {
  // The maximal pack: AVGO with every optional or nullable field the schema allows populated.
  const maximal = loadPack("AVGO");
  const ex = (s: string) => ({ text: `${s} excerpt text`, source: `edgar:${s}`, url: `https://example.test/${s}`, asOf: "2026-08-02", truncated: true });
  const c = maximal.context;
  c.description = { ...c.description, url: "https://example.test/description", truncated: true };
  const NULLABLE_EXCERPTS = ["mdaExcerpt", "riskFactorsExcerpt", "pressRelease", "proxyStatement", "transcriptHighlights"] as const;
  for (const k of NULLABLE_EXCERPTS) c[k] = { ...(c[k] ?? ex(k)), url: c[k]?.url ?? `https://example.test/${k}`, truncated: true };
  c.riskFactorsSource ??= "10-K";
  if (!c.headlines.length) c.headlines = [ex("h1"), ex("h2")];
  maximal.quote.sharesSource = "cover";
  for (const k of Object.keys(maximal.ttm) as (keyof FactPack["ttm"])[]) maximal.ttm[k] ??= 1.25;
  maximal.latestQuarter.operatingMargin ??= 0.2;
  maximal.latestQuarter.revenueYoY ??= 0.1;
  for (const k of ["nextFY", "followingFY"] as const) { maximal.estimates[k].revenue ??= 1e11; maximal.estimates[k].eps ??= 10; }
  for (const s of ["income", "balance", "cashflow"] as const) for (const r of maximal.statements[s]) r.values = r.values.map((v) => v ?? 1.5e9);
  if (!maximal.segments.items.length) maximal.segments.items = [{ name: "A", revenue: 6e10, share: 0.6 }, { name: "B", revenue: 4e10, share: 0.4 }];
  if (!maximal.geoMix.items.length) maximal.geoMix.items = [{ region: "Americas", share: 0.7 }, { region: "Asia", share: 0.3 }];
  maximal.goodwillRestated ??= ["FY24"];
  maximal.crosscheckOverrides ??= [{ field: "price", reason: "verified", verifiedAgainst: "10-Q", capturedAt: "2026-08-02" }];

  // Each field with its absent form; the minimal twin applies every one (children before their parents).
  const fields: { path: Path; absent: unknown }[] = [
    ...["description", ...NULLABLE_EXCERPTS].flatMap((k) => [
      { path: ["context", k, "truncated"], absent: undefined }, { path: ["context", k, "url"], absent: undefined },
    ]),
    ...NULLABLE_EXCERPTS.map((k) => ({ path: ["context", k], absent: null })),
    { path: ["context", "riskFactorsSource"], absent: null },
    { path: ["context", "headlines"], absent: [] },
    { path: ["quote", "sharesSource"], absent: "derived" },
    ...Object.keys(maximal.ttm).map((k) => ({ path: ["ttm", k], absent: null })),
    { path: ["latestQuarter", "operatingMargin"], absent: null }, { path: ["latestQuarter", "revenueYoY"], absent: null },
    ...["nextFY", "followingFY"].flatMap((k) => [{ path: ["estimates", k, "revenue"], absent: null }, { path: ["estimates", k, "eps"], absent: null }]),
    ...(["income", "balance", "cashflow"] as const).flatMap((s) => maximal.statements[s].flatMap((r, i) => [
      ...r.values.map((_, j) => ({ path: ["statements", s, i, "values", j], absent: null })),
      { path: ["statements", s, i, "values"], absent: r.values.map(() => null) },
    ])),
    { path: ["segments", "items"], absent: [] }, { path: ["geoMix", "items"], absent: [] }, { path: ["peers"], absent: [] },
    ...["sic", "sicDescription", "goodwill", "goodwillRestated", "sbc", "beta", "shibuiCheck", "crosscheckOverrides"].map((k) => ({ path: [k], absent: undefined })),
  ];
  const minimal = structuredClone(maximal);
  for (const f of fields) if (getAt(minimal, f.path.slice(0, -1)) != null) setAt(minimal, f.path, structuredClone(f.absent));

  it("the maximal pack populates every highlight key, and both twins parse", () => {
    expect(Object.keys(projectReportFacts(maximal).highlightCells).sort()).toEqual([...HIGHLIGHT_KEYS].sort());
    expect(FactPack.safeParse(maximal).success).toBe(true);
    expect(FactPack.safeParse(minimal).success).toBe(true);
    expect(observe(minimal)).not.toBeNull();
  });

  it("absent → present on the minimal pack, and present → absent on the maximal one, moves the component wherever the render moves", () => {
    const found: string[] = [];
    let tested = 0;
    for (const f of fields) {
      const label = f.path.join(".");
      if (getAt(minimal, f.path.slice(0, -1)) != null) {
        const p = structuredClone(minimal);
        setAt(p, f.path, structuredClone(getAt(maximal, f.path)));
        if (observe(p)) tested++;
        found.push(...gaps(minimal, p, `${label} (absent→present)`));
      }
      const q = structuredClone(maximal);
      setAt(q, f.path, structuredClone(f.absent));
      found.push(...gaps(maximal, q, `${label} (present→absent)`));
    }
    expect(tested).toBeGreaterThan(fields.length / 2);
    expect(found, GAP).toEqual([]);
  });
});
