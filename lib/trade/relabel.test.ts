import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Report } from "../report.schema";
import { DESK_RATING_DEFAULTS } from "../synth/desk.schema";
import {
  relabelCandidates, advanceRelabels, confirmedRelabels, relabelLine, readRelabelState, writeRelabelState,
  RELABEL_CONFIRM_DAYS, type RelabelEntry,
} from "./relabel";

const rating = structuredClone(DESK_RATING_DEFAULTS);

// VST as published October 6, 2026: Bull $210.25 / Base $174.05 / Bear $106.00 at 25/55/20 (fair value ≈ $169.49),
// HOLD at $160.50 (E +5.6%, R 0.16×).
function report(o: { ticker?: string; label?: string; published?: string; ceiling?: string; accession?: string; gate?: boolean; conviction?: boolean } = {}): Report {
  const published = o.published ?? "HOLD";
  return {
    meta: { ticker: o.ticker ?? "VST", filing: { accession: o.accession ?? "0001692819-26-000019" } },
    rating: {
      label: o.label ?? published,
      ...(o.conviction === false ? {} : { conviction: { expectedUpside: 0.056, bearDownside: 0.34, rewardRisk: 0.165, derivedLabel: published } }),
      ...(o.gate === false ? {} : { gate: { sector: "utility", ceiling: o.ceiling ?? "STRONG BUY", gatedLabel: published } }),
    },
    sections: { valuation: { scenarios: [
      { name: "Bull", driver: "", impliedPrice: 210.25, probability: 0.25 },
      { name: "Base", driver: "", impliedPrice: 174.05, probability: 0.55 },
      { name: "Bear", driver: "", impliedPrice: 106.0, probability: 0.2 },
    ] } },
  } as unknown as Report;
}

describe("relabelCandidates", () => {
  it("flags nothing while the live label matches the published one", () => {
    expect(relabelCandidates([report()], { VST: 160.5 }, rating)).toEqual([]);
  });

  it("flags a HOLD that derives BUY at today's mark", () => {
    const [e] = relabelCandidates([report()], { VST: 145 }, rating);
    expect(e).toMatchObject({ ticker: "VST", accession: "0001692819-26-000019", publishedLabel: "HOLD", liveLabel: "BUY", reportLabel: "HOLD", price: 145 });
    expect(e.expectedUpside).toBeCloseTo(169.49 / 145 - 1, 4);
    expect(e.rewardRisk).toBeCloseTo((169.49 / 145 - 1) / ((145 - 106) / 145), 4);
  });

  it("flags a HOLD that derives SELL after a run-up", () => {
    expect(relabelCandidates([report()], { VST: 185 }, rating)[0]).toMatchObject({ publishedLabel: "HOLD", liveLabel: "SELL" });
  });

  it("applies the publish-time gate ceiling to the live label", () => {
    expect(relabelCandidates([report({ ceiling: "HOLD" })], { VST: 145 }, rating)).toEqual([]);
  });

  it("compares rule to rule: an author's conservative notch alone is not a candidate", () => {
    // Published rule label BUY, author chose HOLD; at a price where the rule still says BUY, nothing to flag.
    expect(relabelCandidates([report({ published: "BUY", label: "HOLD" })], { VST: 145 }, rating)).toEqual([]);
    // When the rule moves, the author's label rides along for display.
    expect(relabelCandidates([report({ published: "BUY", label: "HOLD" })], { VST: 160.5 }, rating)[0]).toMatchObject({ publishedLabel: "BUY", liveLabel: "HOLD", reportLabel: "HOLD" });
  });

  it("falls back to the derived label when the report has no gate block", () => {
    expect(relabelCandidates([report({ gate: false })], { VST: 145 }, rating)[0]).toMatchObject({ publishedLabel: "HOLD", liveLabel: "BUY" });
  });

  it("skips a report with no publish-time label, and a missing or non-positive mark", () => {
    expect(relabelCandidates([report({ gate: false, conviction: false })], { VST: 145 }, rating)).toEqual([]);
    expect(relabelCandidates([report()], {}, rating)).toEqual([]);
    expect(relabelCandidates([report()], { VST: 0 }, rating)).toEqual([]);
    expect(relabelCandidates([report()], { VST: Number.NaN }, rating)).toEqual([]);
  });
});

const entry = (over: Partial<RelabelEntry> = {}): RelabelEntry => ({
  ticker: "VST", accession: "a1", publishedLabel: "HOLD", liveLabel: "BUY", reportLabel: "HOLD",
  price: 145, expectedUpside: 0.169, rewardRisk: 0.63, ...over,
});

describe("advanceRelabels / confirmedRelabels", () => {
  it(`confirms only after ${RELABEL_CONFIRM_DAYS} consecutive run days`, () => {
    let s = advanceRelabels({}, "2026-10-07", [entry()]);
    expect(confirmedRelabels(s, [entry()])).toEqual([]);
    s = advanceRelabels(s, "2026-10-08", [entry()]);
    expect(confirmedRelabels(s, [entry()])).toEqual([]);
    s = advanceRelabels(s, "2026-10-09", [entry()]);
    expect(confirmedRelabels(s, [entry()])).toEqual([{ ...entry(), days: 3 }]);
    s = advanceRelabels(s, "2026-10-12", [entry()]); // a weekend with no run does not break it
    expect(confirmedRelabels(s, [entry()])[0].days).toBe(4);
  });

  it("counts a second run on the same day once", () => {
    let s = advanceRelabels({}, "2026-10-07", [entry()]);
    s = advanceRelabels(s, "2026-10-07", [entry()]);
    s = advanceRelabels(s, "2026-10-08", [entry()]);
    expect(s.VST.days).toEqual(["2026-10-07", "2026-10-08"]);
    expect(confirmedRelabels(s, [entry()])).toEqual([]);
  });

  it("restarts the streak when the live label, published label or report changes", () => {
    const base = advanceRelabels(advanceRelabels({}, "2026-10-07", [entry()]), "2026-10-08", [entry()]);
    expect(advanceRelabels(base, "2026-10-09", [entry({ liveLabel: "STRONG BUY" })]).VST.days).toEqual(["2026-10-09"]);
    expect(advanceRelabels(base, "2026-10-09", [entry({ publishedLabel: "SELL" })]).VST.days).toEqual(["2026-10-09"]);
    expect(advanceRelabels(base, "2026-10-09", [entry({ accession: "a2" })]).VST.days).toEqual(["2026-10-09"]);
  });

  it("drops a ticker on a run day it is not a candidate", () => {
    let s = advanceRelabels({}, "2026-10-07", [entry()]);
    s = advanceRelabels(s, "2026-10-08", [entry()]);
    s = advanceRelabels(s, "2026-10-09", []);
    expect(s).toEqual({});
    s = advanceRelabels(s, "2026-10-10", [entry()]);
    expect(s.VST.days).toEqual(["2026-10-10"]);
  });

  it("does not confirm today's entry against a streak for a different key", () => {
    const s = advanceRelabels(advanceRelabels(advanceRelabels({}, "2026-10-07", [entry()]), "2026-10-08", [entry()]), "2026-10-09", [entry()]);
    expect(confirmedRelabels(s, [entry({ liveLabel: "STRONG BUY" })])).toEqual([]);
  });
});

describe("relabelLine", () => {
  it("reads published → live with the mark, E, R and the streak", () => {
    expect(relabelLine({ ...entry(), days: 3 })).toBe("VST HOLD → BUY at $145.00 · E +16.9% · R 0.63× · 3 days");
  });
  it("shows the author's label when it differs, and a null R", () => {
    expect(relabelLine({ ...entry({ publishedLabel: "BUY", liveLabel: "SELL", reportLabel: "HOLD", expectedUpside: -0.08, rewardRisk: null }), days: 5 }))
      .toBe("VST BUY → SELL at $145.00 · E -8.0% · R n/a · 5 days (report says HOLD)");
  });
});

describe("relabel state file", () => {
  it("round-trips, and reads a missing or corrupt file as empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "relabel-"));
    const p = join(dir, "sub", "relabel-state.json");
    expect(readRelabelState(p)).toEqual({});
    const s = advanceRelabels({}, "2026-10-07", [entry()]);
    writeRelabelState(p, s);
    expect(readRelabelState(p)).toEqual(s);
    writeFileSync(p, "{not json");
    expect(readRelabelState(p)).toEqual({});
    writeFileSync(p, JSON.stringify({ VST: { key: 1 } }));
    expect(readRelabelState(p)).toEqual({});
  });
});
