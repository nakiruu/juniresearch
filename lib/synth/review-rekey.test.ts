import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FactPack } from "@/lib/facts/schema";
import { projectReportFacts } from "@/lib/facts/project";
import { Desk, type DeskRating } from "@/lib/synth/desk.schema";
import { Judgment } from "@/lib/synth/judgment.schema";
import { pct } from "@/lib/format";
import { computeConviction, deriveLabel } from "@/lib/synth/conviction";
import { groundJudgment, groundingSurface } from "@/lib/synth/validate-judgment";
import { reviewInputs, sha256, canon } from "@/lib/synth/review-inputs";
import { rekeyCalls, replaceInputsText } from "@/lib/synth/review-rekey";

const FIX = "lib/__fixtures__/review-inputs";
const desk = Desk.parse(JSON.parse(readFileSync(`${FIX}/desk.json`, "utf8")));
const load = (t: string) => {
  const pack = FactPack.parse(JSON.parse(readFileSync(`${FIX}/${t}.pack.json`, "utf8")));
  const judgment = Judgment.parse(JSON.parse(readFileSync(`${FIX}/${t}.judgment.json`, "utf8")));
  return { pack, facts: projectReportFacts(pack), judgment };
};
const SHA = "abc1234";
const stampFor = (t: ReturnType<typeof load>, rating: DeskRating) => ({ ...reviewInputs(t.pack, { rating }, t.facts), source: "backfill:7ce1382" });
const run = (t: ReturnType<typeof load>, oldRating: DeskRating, newRating: DeskRating, stamp = stampFor(t, oldRating)) =>
  rekeyCalls({ stamp, judgment: t.judgment, pack: t.pack, facts: t.facts, desk, oldRating, newRating, rekeySha: SHA });

describe("rekeyCalls", () => {
  const avgo = load("AVGO");
  it("restamps calls with the rekey source when the label holds and validate passes", () => {
    const newRating = { ...desk.rating, strongSell: { maxUpside: -0.25 } };
    const r = run(avgo, desk.rating, newRating);
    expect(r).toEqual({ action: "restamp", stamp: { ...stampFor(avgo, desk.rating), calls: sha256(canon(newRating)), source: `rekey:${SHA}` } });
  });

  it("sends a label that flips at a threshold to re-review", () => {
    const c = computeConviction(avgo.judgment.sections.valuation.scenarios, avgo.pack.quote.price);
    const old = deriveLabel(c, desk.rating);
    // move the BUY bar just above this report's expected upside (or the SELL bar just above it)
    const newRating = old === "HOLD"
      ? { ...desk.rating, sell: { maxUpside: Math.min(-0.001, c.expectedUpside + 0.001) }, strongSell: { maxUpside: Math.min(-0.002, c.expectedUpside) - 0.2 } }
      : { ...desk.rating, buy: { ...desk.rating.buy, minUpside: c.expectedUpside + 0.001 }, strongBuy: { ...desk.rating.strongBuy, minUpside: Math.max(desk.rating.strongBuy.minUpside, c.expectedUpside + 0.01) } };
    expect(deriveLabel(c, newRating)).not.toBe(old);
    const r = run(avgo, desk.rating, newRating);
    expect(r.action).toBe("reReview");
    expect(r.action === "reReview" && r.reason).toMatch(new RegExp(`label ${old}→`));
  });

  it("does not blanket-restamp a raised bear floor: the label holds, but a Bear between the floors goes to re-review", () => {
    const raised = { ...desk.rating, bearFloor: desk.rating.bearFloor + 0.05 };
    const results: Record<string, string> = {};
    for (const t of ["AVGO", "JPM", "UEC"]) {
      const x = load(t);
      const c = computeConviction(x.judgment.sections.valuation.scenarios, x.pack.quote.price);
      expect(deriveLabel(c, raised)).toBe(deriveLabel(c, desk.rating));
      results[t] = run(x, desk.rating, raised).action;
    }
    // JPM's Bear sits between the floors (one of the 23 the plan measured); AVGO's and UEC's clear the raised floor
    expect(results).toEqual({ AVGO: "restamp", JPM: "reReview", UEC: "restamp" });
    // a synthetic Bear between the old and new floors
    const synth = structuredClone(avgo);
    const price = synth.pack.quote.price;
    const bear = synth.judgment.sections.valuation.scenarios.find((s) => s.name === "Bear")!;
    bear.impliedPrice = Math.round(price * (1 - desk.rating.bearFloor - 0.02) * 100) / 100;
    expect(run(synth, desk.rating, desk.rating)).toMatchObject({ action: "restamp" });
    const r = run(synth, desk.rating, raised);
    expect(r).toMatchObject({ action: "reReview" });
    expect(r.action === "reReview" && r.reason).toMatch(/rating issue: .*bear case/);
  });

  it("sends a judgment that quotes a Calls threshold the new rule changes to re-review", () => {
    const oldRating = { ...desk.rating, strongSell: { maxUpside: -0.237 } };
    const newRating = { ...desk.rating, strongSell: { maxUpside: -0.241 } };
    const quoted = pct(-0.237, { signed: true });
    const x = structuredClone(avgo);
    x.judgment.sections.valuation.scenarioCommentary += ` The desk's STRONG SELL bar sits at E ≤ ${quoted}.`;
    const errs = (rating: DeskRating) => groundJudgment(x.judgment, groundingSurface(x.judgment, x.facts, x.pack, { ...desk, rating })).errors.map((e) => e.token.raw);
    expect(errs(oldRating)).not.toContain(quoted.replace(/^[+−-]/, ""));
    expect(errs(oldRating)).toEqual([]);
    const r = run(x, oldRating, newRating);
    expect(r).toMatchObject({ action: "reReview" });
    expect(r.action === "reReview" && r.reason).toMatch(/grounding: .*23\.7%/);
  });

  it("leaves a stamp from another rule, or one already stale on facts or context, untouched", () => {
    const newRating = { ...desk.rating, strongSell: { maxUpside: -0.25 } };
    const other = { ...stampFor(avgo, desk.rating), calls: "f".repeat(64) };
    expect(run(avgo, desk.rating, newRating, other)).toEqual({ action: "untouched", reason: "not this change" });
    const staleFacts = { ...stampFor(avgo, desk.rating), facts: "f".repeat(64) };
    expect(run(avgo, desk.rating, newRating, staleFacts)).toMatchObject({ action: "untouched", reason: expect.stringMatching(/already stale/) });
  });
});

describe("replaceInputsText", () => {
  const stamp = { scheme: 1 as const, facts: "1".repeat(64), calls: "2".repeat(64), context: "3".repeat(64), source: "rekey:abc1234" };
  const old = { scheme: 1, facts: "a".repeat(64), calls: "b".repeat(64), context: "c".repeat(64) };
  it("replaces a one-line or a pretty-printed inputs object, keeping layout and EOL, and nothing else", () => {
    for (const eol of ["\n", "\r\n"]) {
      const oneLine = ["{", `  "judgmentSha256": "${"d".repeat(64)}",`, `  "inputs": ${JSON.stringify(old)},`, `  "round": 1`, "}", ""].join(eol);
      const pretty = JSON.stringify({ judgmentSha256: "d".repeat(64), inputs: old, round: 1 }, null, 2).replace(/\n/g, eol) + eol;
      for (const text of [oneLine, pretty]) {
        const out = replaceInputsText(text, stamp);
        expect(JSON.parse(out)).toEqual({ ...JSON.parse(text), inputs: stamp });
        const [head, tail] = [text.slice(0, text.indexOf('"inputs"')), text.slice(text.indexOf("}", text.indexOf('"inputs"')) + 1)];
        expect(out).toBe(`${head}"inputs": ${JSON.stringify(stamp)}${tail}`);
      }
    }
  });
  it("refuses a file without exactly one inputs object", () => {
    expect(() => replaceInputsText(`{ "round": 1 }`, stamp)).toThrow(/exactly one/);
  });
});
