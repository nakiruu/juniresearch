import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFactPack } from "../lib/facts/build";
import { projectReportFacts } from "../lib/facts/project";
import { formatCell, formatSnapshot } from "../lib/format";
import { Report } from "../lib/report.schema";

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run facts:diff -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const facts = projectReportFacts(buildFactPack(join("data", "raw", ticker, accession)));
const golden = Report.parse(JSON.parse(readFileSync(join("lib", "__fixtures__", "avgo-golden.json"), "utf8")));

let same = 0, diff = 0;
const line = (where: string, a: string, b: string) => { const ok = a === b; if (ok) same++; else diff++; console.log(`${ok ? "  " : "! "}${where.padEnd(44)} facts=${a.padEnd(18)} golden=${b}`); };
for (const t of ["income", "balance", "cashflow"] as const)
  for (const g of facts.sections.financials[t].rows) {
    const w = golden.sections.financials[t].rows.find((r) => r.label === g.label); if (!w) continue;
    g.values.forEach((v, i) => line(`${t}.${g.label}[${golden.sections.financials[t].columns[i + 1]}]`, formatCell(v, g.format), formatCell(w.values[i], w.format)));
  }
for (const c of facts.snapshot) { const w = golden.snapshot.find((x) => x.label === c.label); if (w) line(`snapshot.${c.label}`, formatSnapshot(c), formatSnapshot(w)); }
for (const k of ["consensusTarget", "medianTarget", "highTarget", "lowTarget", "numAnalysts"] as const)
  line(`analystSentiment.${k}`, String(facts.analystSentiment[k]), String(golden.analystSentiment[k]));
for (const c of facts.sections.valuation.multiplesCompanyColumn) {
  const w = golden.sections.valuation.multiples.rows.find((r) => r.label === c.label);
  if (w) line(`valuation.${c.label}`, formatCell(c.value, "mult"), formatCell(w.values[0], "mult"));
}
console.log(`\n${same} match, ${diff} differ. Quote/target/estimate fields drift daily; statement rows and multiples should match.`);
