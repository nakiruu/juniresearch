import { describe, it, expect } from "vitest";
import { issueLine, renderErrorsFile, parseErrorsFile, WARNINGS_HEADING } from "@/lib/synth/errors-file";

describe("issueLine", () => {
  it("renders a plain validation issue as the loop always has", () => {
    expect(issueLine({ field: "rating.label", message: "BUY is inconsistent with an upside of -3.0%", value: "BUY" }))
      .toBe('rating.label: BUY is inconsistent with an upside of -3.0% (received "BUY")');
  });
  it("renders a lint issue with its rule prefix", () => {
    expect(issueLine({ rule: "span-scope", severity: "error", field: "sections.management.governance", message: "this span wraps 7 words and no figure", value: "{- x -}" }))
      .toBe('lint/span-scope: sections.management.governance: this span wraps 7 words and no figure (received "{- x -}")');
  });
  it("prefixes a lint warning with warn:", () => {
    expect(issueLine({ rule: "tic", severity: "warning", field: "analystCommentary", message: '"leg" appears 11 times', value: "leg" }))
      .toBe('warn: lint/tic: analystCommentary: "leg" appears 11 times (received "leg")');
  });
});

describe("the errors file", () => {
  const errors = ["rating.label: bad (received 1)", "lint/figure-repeat: a: twice (received 2)"];
  const warnings = ['warn: lint/tic: b: "leg" appears 11 times (received "leg")'];

  it("puts the warnings in their own block after the errors", () => {
    const text = renderErrorsFile(errors, warnings);
    expect(text).toBe(`${errors.join("\n")}\n\n${WARNINGS_HEADING}\n${warnings.join("\n")}\n`);
  });
  it("omits the block when there are no warnings, and ends with a newline", () => {
    expect(renderErrorsFile(errors, [])).toBe(`${errors.join("\n")}\n`);
  });
  it("writes a warnings-only file when the build passed with warnings", () => {
    expect(renderErrorsFile([], warnings)).toBe(`${WARNINGS_HEADING}\n${warnings.join("\n")}\n`);
  });
  it("round-trips", () => {
    for (const pair of [[errors, warnings], [errors, []], [[], warnings], [[], []]] as [string[], string[]][])
      expect(parseErrorsFile(renderErrorsFile(pair[0], pair[1]))).toEqual({ errors: pair[0], warnings: pair[1] });
  });
  it("reads a pre-3b errors file (no warnings block) as all errors", () => {
    expect(parseErrorsFile("rating.label: bad (received 1)\nsections.growth.points[0]: worse (received 2)\n"))
      .toEqual({ errors: ["rating.label: bad (received 1)", "sections.growth.points[0]: worse (received 2)"], warnings: [] });
  });
});
