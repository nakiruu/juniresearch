import { describe, it, expect } from "vitest";
import { FISCAL_LABEL_OVERRIDES, fiscalLabelOverride } from "./fiscal-labels";

describe("FISCAL_LABEL_OVERRIDES", () => {
  it("holds exactly the owner-approved entries (an addition must change this test)", () => {
    expect(FISCAL_LABEL_OVERRIDES).toEqual({
      LQDT: { labels: "calendar" },
      CHWY: { yearOffset: -1 },
    });
  });
  it("looks a ticker up case-insensitively and gives every other filer no override", () => {
    expect(fiscalLabelOverride("chwy")).toEqual({ yearOffset: -1 });
    expect(fiscalLabelOverride("LQDT")).toEqual({ labels: "calendar" });
    expect(fiscalLabelOverride("AMSC")).toEqual({});
    expect(fiscalLabelOverride("V")).toEqual({});
  });
});
