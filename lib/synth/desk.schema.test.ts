import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Desk, DESK_LINT_DEFAULTS, DESK_RATING_DEFAULTS } from "@/lib/synth/desk.schema";

describe("Desk config", () => {
  it("parses data/desk/desk.json with the desk identity and at least three style rules", () => {
    const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));
    expect(desk.analyst).toBe("Juniper Finance Research Desk");
    expect(desk.analystName).toBe("Nico — Senior Analyst");
    expect(desk.disclaimer.startsWith("DISCLAIMER:")).toBe(true);
    expect(desk.styleRules.length).toBeGreaterThanOrEqual(3);
  });
  it("rejects a blank analyst and an empty rule list", () => {
    expect(() => Desk.parse({ analyst: " ", analystName: "x", disclaimer: "x", styleRules: [] })).toThrow();
  });
});

describe("Desk.lint and Desk.review", () => {
  const base = { analyst: "a", analystName: "b", disclaimer: "c", styleRules: ["one", "two", "three"] };

  it("fills both blocks with the desk defaults when they are absent", () => {
    const desk = Desk.parse(base);
    expect(desk.lint.hypeWords).toEqual(["massive", "incredible", "game-changing", "skyrocket", "skyrocketing", "revolutionary", "explosive"]);
    expect(desk.lint.superlatives).toEqual(["record", "fastest", "largest", "biggest", "highest", "unprecedented", "best-ever"]);
    expect(desk.lint.attributionPhrases).toContain("what management calls");
    expect(desk.lint.tics).toEqual(["this pack", "worth naming", "worth stating", "worth noticing", "is where", "leg"]);
    expect(desk.lint.ticLimit).toBe(4);
    expect(desk.lint.similarity).toEqual({ error: 0.8, warning: 0.6 });
    expect(desk.review.model).toBe("opus");
  });

  it("takes the desk's overrides when they are present", () => {
    const desk = Desk.parse({ ...base, lint: { tics: ["leg"], ticLimit: 1, similarity: { error: 0.9, warning: 0.7 } }, review: { model: "sonnet" } });
    expect(desk.lint.tics).toEqual(["leg"]);
    expect(desk.lint.ticLimit).toBe(1);
    expect(desk.lint.similarity.error).toBe(0.9);
    expect(desk.lint.hypeWords).toEqual(DESK_LINT_DEFAULTS.hypeWords);   // untouched keys keep their defaults
    expect(desk.review.model).toBe("sonnet");
  });

  it("rejects a similarity warning threshold at or above the error threshold", () => {
    expect(() => Desk.parse({ ...base, lint: { similarity: { error: 0.6, warning: 0.8 } } })).toThrow();
  });

  it("carries both blocks explicitly in the committed desk.json", () => {
    const raw = JSON.parse(readFileSync("data/desk/desk.json", "utf8")) as Record<string, unknown>;
    expect(raw.lint).toBeDefined();
    expect(raw.review).toEqual({ model: "opus" });
    const desk = Desk.parse(raw);
    expect(desk.lint.ticLimit).toBe(4);
  });
});

describe("Desk.rating", () => {
  const base = { analyst: "a", analystName: "b", disclaimer: "c", styleRules: ["one", "two", "three"] };

  it("fills the rating block with the desk defaults when it is absent", () => {
    const desk = Desk.parse(base);
    expect(desk.rating).toEqual({
      bearFloor: 0.15,
      strongBuy: { minUpside: 0.2, minRewardRisk: 1.0 },
      buy: { minUpside: 0.1, minRewardRisk: 0.5 },
      sell: { maxUpside: -0.05 },
      strongSell: { maxUpside: -0.2 },
    });
    expect(desk.rating).toEqual(DESK_RATING_DEFAULTS);
  });

  it("takes overrides and keeps the untouched keys at their defaults", () => {
    const desk = Desk.parse({ ...base, rating: { bearFloor: 0.2, strongBuy: { minUpside: 0.25, minRewardRisk: 0.75 } } });
    expect(desk.rating.bearFloor).toBe(0.2);
    expect(desk.rating.strongBuy).toEqual({ minUpside: 0.25, minRewardRisk: 0.75 });
    expect(desk.rating.buy).toEqual(DESK_RATING_DEFAULTS.buy);
  });

  it.each([
    ["bearFloor at 0", { bearFloor: 0 }],
    ["bearFloor at 1", { bearFloor: 1 }],
    ["buy.minUpside not below strongBuy.minUpside", { buy: { minUpside: 0.2, minRewardRisk: 0.5 } }],
    ["buy.minRewardRisk above strongBuy.minRewardRisk", { buy: { minUpside: 0.1, minRewardRisk: 1.5 } }],
    ["sell.maxUpside not negative", { sell: { maxUpside: 0 } }],
    ["strongSell.maxUpside not below sell.maxUpside", { strongSell: { maxUpside: -0.05 } }],
    ["a zero reward/risk floor", { buy: { minUpside: 0.1, minRewardRisk: 0 } }],
  ])("rejects %s", (_name, rating) => {
    expect(() => Desk.parse({ ...base, rating })).toThrow();
  });

  it("carries the rating block explicitly in the committed desk.json", () => {
    const raw = JSON.parse(readFileSync("data/desk/desk.json", "utf8")) as Record<string, unknown>;
    expect(raw.rating).toEqual(DESK_RATING_DEFAULTS);
  });
});
