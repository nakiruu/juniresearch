import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Report, SCHEMA_VERSION } from "../lib/report.schema";

const [tickerArg, accession] = process.argv.slice(2);
if (!tickerArg || !accession) { console.error("usage: npm run report:history -- <TICKER> <ACCESSION>"); process.exit(2); }
const ticker = tickerArg.toUpperCase();
const pack = JSON.parse(readFileSync(join("data", "facts", ticker, `${accession}.json`), "utf8")) as { history: { date: string; close: number }[] };
const reportPath = join("data", `${ticker.toLowerCase()}.json`);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
report.schemaVersion = SCHEMA_VERSION;
report.quote.history = pack.history;
Report.parse(report);
writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`Wrote ${pack.history.length} closes into ${reportPath} (schema ${SCHEMA_VERSION})`);
