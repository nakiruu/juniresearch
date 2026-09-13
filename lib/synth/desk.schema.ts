/**
 * desk.schema.ts — the research desk's identity and house style.
 * -----------------------------------------------------------------------------
 * Config, not judgment: the model never authors these. Loaded from
 * data/desk/desk.json by the synth CLIs (one level below data/, because
 * lib/reports.ts treats every data/*.json as a report).
 */
import { z } from "zod";

const text = (max: number) => z.string().regex(/\S/, "must not be blank").max(max);

export const Desk = z.strictObject({
  analyst: text(80),
  analystName: text(80),
  disclaimer: text(1200),
  styleRules: z.array(text(200)).min(3).max(10),
});
export type Desk = z.infer<typeof Desk>;
