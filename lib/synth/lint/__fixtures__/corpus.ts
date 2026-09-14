/** The regression corpus: five judgments lifted from git history, with the defects the desk found by hand. */
import { readFileSync } from "node:fs";
import { Judgment } from "../../judgment.schema";

export const CORPUS_NAMES = ["orcl-10q-before", "orcl-10q-after", "orcl-gov-before", "avgo-gov-before", "avgo-final"] as const;
export type CorpusName = (typeof CORPUS_NAMES)[number];

export function loadCorpus(name: CorpusName): Judgment {
  return Judgment.parse(JSON.parse(readFileSync(`lib/synth/lint/__fixtures__/${name}.json`, "utf8")));
}
