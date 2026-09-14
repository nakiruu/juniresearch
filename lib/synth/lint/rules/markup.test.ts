import { describe, it, expect } from "vitest";
import { markup } from "@/lib/synth/lint/rules/markup";
import { unit } from "@/lib/synth/lint/__fixtures__/units";

const one = (text: string) => markup([unit("management", [["sections.management.governance", text]])]);

describe("span-scope", () => {
  it("flags a bearish span wrapped around a clause with no figure", () => {
    const issues = one("{- Mr. Hartenstein was not standing for re-election -} and intended to serve out the term.");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: "span-scope",
      severity: "error",
      field: "sections.management.governance",
      value: "{- Mr. Hartenstein was not standing for re-election -}",
    });
    expect(issues[0].message).toMatch(/signed changes or explicit positives/);
  });

  it("accepts a span that carries a figure, however long", () => {
    expect(one("Revenue grew {+ +29.6% year over year on the cloud mix +} in the quarter.")).toEqual([]);
  });

  it("accepts a span of three words or fewer without a figure", () => {
    expect(one("The quarter was {- materially worse sequentially -} for margins.")).toEqual([]);
  });

  it("flags at four words without a figure — the boundary", () => {
    expect(one("The quarter was {- materially worse than last sequentially -} for margins.").map((i) => i.rule)).toEqual(["span-scope"]);
  });

  it("flags each offending span separately", () => {
    expect(one("{- the board did not renew the mandate -} and {+ the committee approved the buyback instead +}.")).toHaveLength(2);
  });

  it("says nothing about prose with no spans, or an empty leaf", () => {
    expect(one("Plain prose with no markers at all.")).toEqual([]);
    expect(markup([unit("risks", [["sections.risks.systemic", ""]])])).toEqual([]);
  });
});

describe("rhetorical-question", () => {
  it("flags a question in a unit's prose, quoting the sentence", () => {
    const issues = one("Margins held. So what does the backlog really buy? The answer is capacity.");
    expect(issues.map((i) => [i.rule, i.severity, i.value]))
      .toEqual([["rhetorical-question", "error", "So what does the backlog really buy?"]]);
  });
  it("flags each question separately", () => {
    expect(one("Is that cheap? Is it durable?")).toHaveLength(2);
  });
  it("says nothing about prose with no question mark", () => {
    expect(one("The backlog buys capacity, not certainty.")).toEqual([]);
  });
});
