/** Synthetic inputs for the rule tests: a unit built by hand, and a judgment with nothing to say. */
import { Judgment } from "../../judgment.schema";
import type { SectionUnit, UnitName } from "../units";
import { unitFor } from "../units";
import golden from "@/lib/__fixtures__/avgo-golden-judgment.json";

export const unit = (name: UnitName, leaves: [string, string][]): SectionUnit => ({
  name,
  leaves: leaves.map(([path, text]) => ({ path, text })),
});

/**
 * The golden judgment with every leaf that belongs to a unit replaced by a short,
 * figure-free sentence naming its own path — under the eight-word repetition floor,
 * so no rule has anything to report. Excluded leaves (enums, labels) keep their values.
 */
const rewrite = (value: unknown, path = ""): unknown => {
  if (typeof value === "string") return unitFor(path) ? `Section note for ${path}.` : value;
  if (Array.isArray(value)) return value.map((v, i) => rewrite(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, path ? `${path}.${k}` : k)]));
  return value;
};

export const cleanJudgment = (): Judgment => Judgment.parse(rewrite(golden));
