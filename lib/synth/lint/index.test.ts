import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Desk } from "@/lib/synth/desk.schema";
import { lintJudgment, lintLine } from "@/lib/synth/lint";
import { cleanJudgment } from "@/lib/synth/lint/__fixtures__/units";

const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));

describe("lintJudgment", () => {
  it("returns no issue for a judgment with no prose issues", () => {
    expect(lintJudgment(cleanJudgment(), desk)).toEqual([]);
  });
  it("is deterministic", () => {
    const j = cleanJudgment();
    expect(lintJudgment(j, desk)).toEqual(lintJudgment(j, desk));
  });
});

describe("lintLine", () => {
  it("prints an error with its rule, field, message and value", () => {
    expect(lintLine({ rule: "figure-repeat", severity: "error", field: "sections.financials.incomeCommentary", message: '"65.2%" is introduced twice in financials', value: "65.2%" }))
      .toBe('lint/figure-repeat: sections.financials.incomeCommentary: "65.2%" is introduced twice in financials (received "65.2%")');
  });
  it("prefixes a warning with warn:", () => {
    expect(lintLine({ rule: "tic", severity: "warning", field: "analystCommentary", message: '"leg" appears 11 times', value: "leg" }))
      .toBe('warn: lint/tic: analystCommentary: "leg" appears 11 times (received "leg")');
  });
});
