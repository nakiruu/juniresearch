import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack } from "@/lib/facts/schema";
import { Desk } from "@/lib/synth/desk.schema";
import { canon, reviewInputs, inputsUnder, changedComponents, LEGACY_ENVELOPE_CALLS } from "@/lib/synth/review-inputs";

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
