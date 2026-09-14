import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Desk } from "@/lib/synth/desk.schema";
import { words } from "@/lib/synth/lint/rules/words";
import { unit } from "@/lib/synth/lint/__fixtures__/units";

const desk = Desk.parse(JSON.parse(readFileSync("data/desk/desk.json", "utf8")));
const one = (text: string) => words([unit("management", [["sections.management.governance", text]])], desk);

describe("hype-word", () => {
  it("flags a configured hype word, case-insensitively", () => {
    expect(one("The Massive backlog is the story.").map((i) => [i.rule, i.severity, i.value]))
      .toEqual([["hype-word", "error", "Massive"]]);
  });
  it("matches whole words only", () => {
    expect(one("The explosives segment is small.")).toEqual([]);
  });
  it("takes the list from the desk config", () => {
    const quiet = Desk.parse({ ...desk, lint: { ...desk.lint, hypeWords: ["zippy"] } });
    expect(words([unit("growth", [["sections.growth.points[0]", "A massive but zippy quarter."]])], quiet).map((i) => i.value)).toEqual(["zippy"]);
  });
});

describe("superlative", () => {
  it("flags an unattributed superlative", () => {
    const issues = one("The evidence it offers is fiscal 2025 TSR and record revenue and free cash flow.");
    expect(issues.map((i) => [i.rule, i.severity, i.value])).toEqual([["superlative", "error", "record"]]);
    expect(issues[0].message).toMatch(/attribute it|check the series/);
  });
  it("accepts a superlative the sentence attributes", () => {
    expect(one("Free cash flow was what management calls a record for the year.")).toEqual([]);
    expect(one("Revenue reached what it calls its highest quarterly total.")).toEqual([]);
    expect(one("The release describes as unprecedented the pace of design wins.")).toEqual([]);
  });
  it("accepts a superlative inside straight or curly quotation marks", () => {
    expect(one('The release calls the quarter a "record" for the segment.')).toEqual([]);
    expect(one("The release called the quarter a “record” for the segment.")).toEqual([]);
  });
  it("excludes record where it is not a superlative", () => {
    for (const s of [
      "The governance record is the proxy statement filed in March.",
      "Its record on capital returns is unbroken.",
      "That is not in the record before us.",
      "Nothing on the record supports the inference.",
      "The reported record is silent on the metrics.",
      "Management has the track record to attempt it.",
      "Forward claims we record as claims, not as facts.",
      "The record date has passed.",
      "This record shows eight straight quarters.",
    ])
      expect(one(s), s).toEqual([]);
  });
  it("still flags record used as a superlative next to a figure", () => {
    expect(one("Free cash flow was a record $13.7 billion in the quarter.").map((i) => i.rule)).toEqual(["superlative"]);
  });
  it("flags the other superlatives with no exclusions of their own", () => {
    expect(one("It is the largest segment and the fastest grower on the page.").map((i) => i.value)).toEqual(["largest", "fastest"]);
  });
});

describe("judgment-superlative", () => {
  it("warns on the first and the only used as superlatives", () => {
    expect(one("The dividend is the only shareholder return still running.").map((i) => [i.rule, i.severity, i.value]))
      .toEqual([["judgment-superlative", "warning", "the only"]]);
    expect(one("The first tranche was thirty-five billion of third-party financing.")).toEqual([]);
    expect(one("It was the first tranche of third-party financing.").map((i) => i.value)).toEqual(["the first"]);
  });
  it("does not warn on an attributed use", () => {
    expect(one("The release calls it the first such arrangement.")).toEqual([]);
  });
  it("does not warn on an ordinary period phrase", () => {
    expect(one("First quarter revenue rose while the only other holder sold.").map((i) => i.value)).toEqual(["the only"]);
  });
});

describe("tic", () => {
  const over = (phrase: string, n: number) =>
    words([unit("growth", [["sections.growth.points[0]", Array.from({ length: n }, (_, i) => `Point ${i} is where it lands.`).join(" ")]])], desk)
      .filter((issue) => issue.rule === "tic" && issue.value === phrase);

  it("warns once per phrase whose count across the judgment exceeds the limit", () => {
    expect(desk.lint.ticLimit).toBe(4);
    expect(over("is where", 4)).toHaveLength(0);
    const five = over("is where", 5);
    expect(five).toHaveLength(1);
    expect(five[0].severity).toBe("warning");
    expect(five[0].message).toContain("5");
    expect(five[0].message).toContain("4");
  });

  it("counts across every unit, and matches whole words only", () => {
    const leaves = (n: number) => Array.from({ length: n }, (_, i) => [`sections.growth.points[${i}]`, "The second leg is the one to watch."] as [string, string]);
    expect(words([unit("growth", leaves(5))], desk).filter((i) => i.rule === "tic").map((i) => i.value)).toEqual(["leg"]);
    expect(words([unit("growth", [["sections.growth.points[0]", "Legal, legacy and legible five times over: legal legacy legible legal legacy."]])], desk)
      .filter((i) => i.rule === "tic")).toEqual([]);
  });
});
