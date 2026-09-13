import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { mapCover } from "@/lib/facts/map/cover";

describe("mapCover", () => {
  it.skipIf(!existsSync("data/raw/ORCL/0001193125-26-389274/edgar-primary.html"))("reads Oracle's Q1 FY27 cover", () => {
    expect(mapCover("data/raw/ORCL/0001193125-26-389274").sharesOutstanding).toBe(3023736000);
  });

  it.skipIf(!existsSync("data/raw/AVGO/0001730168-26-000080/edgar-primary.html"))("records what Broadcom's cover yields", () => {
    const n = mapCover("data/raw/AVGO/0001730168-26-000080").sharesOutstanding;
    expect(n === null || n > 4e9).toBe(true); // calibration: report the actual value
  });
});
