import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Fill, parseFillsJsonl, readFills, appendFill } from "./fills";

const fill = (o: Partial<Fill> = {}): Fill => ({
  ticker: "NVT", side: "buy", qty: 10, price: 100, filledAt: "2026-09-21T14:30:00Z",
  tradingDate: "2026-09-21", orderId: "o1", runId: "r1", ...o,
});

describe("Fill schema", () => {
  it("accepts a well-formed fill and rejects a bad trading date or non-positive qty", () => {
    expect(Fill.parse(fill())).toEqual(fill());
    expect(() => Fill.parse(fill({ tradingDate: "21/09/2026" }))).toThrow();
    expect(() => Fill.parse(fill({ qty: 0 }))).toThrow();
  });
});

describe("fills.jsonl round trip", () => {
  it("parses one fill per line, ignoring blank lines", () => {
    const text = JSON.stringify(fill()) + "\n\n" + JSON.stringify(fill({ ticker: "MP", side: "sell" })) + "\n";
    expect(parseFillsJsonl(text).map((f) => f.ticker)).toEqual(["NVT", "MP"]);
  });
  it("appends and reads back in order; a missing file reads as empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "fills-"));
    const p = join(dir, "fills.jsonl");
    expect(readFills(p)).toEqual([]);
    appendFill(p, fill());
    appendFill(p, fill({ ticker: "MP" }));
    expect(readFills(p).map((f) => f.ticker)).toEqual(["NVT", "MP"]);
    expect(readFileSync(p, "utf8").endsWith("\n")).toBe(true);
  });
});
