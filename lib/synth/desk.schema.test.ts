import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Desk } from "@/lib/synth/desk.schema";

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
