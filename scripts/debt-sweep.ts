/**
 * debt-sweep.ts — read-only regression check for the debt concept order (learnings §11: "a concept-order fix for
 * one filer can break another"). For each ticker it parses the captured filing iXBRL (edgar-primary.html and
 * edgar-10k-primary.html — no SEC call), runs parseCompanyFacts, and prints the FY total debt / cash / net debt
 * next to the published pack's values. A mismatch on BSX, NET, ADI, VST, CSCO, AEIS or CALX means the change
 * must not merge.
 *
 *   node --import tsx scripts/debt-sweep.ts BSX NET ADI VST CSCO AEIS CALX [--concepts]
 *
 * --concepts prints every debt-ish instant concept the iXBRL carries, per period — the diagnosis tool for a name
 * whose total does not reconcile.
 *
 * Caveat: the published packs were built from companyfacts + iXBRL, while this sweep uses iXBRL alone. A 10-K's
 * iXBRL carries two balance-sheet years and the 10-Q's one, so three columns are compared at most; older columns
 * print "n/a" and are not counted. A filer whose 10-K iXBRL lacks a revenue concept prints "cannot parse".
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseCompanyFacts } from "../lib/facts/free/sec";
import { parseFilingXbrl, mergeFilingFacts, type CompanyFactsLike } from "../lib/facts/free/filing-xbrl";

const tickers = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((t) => t.toUpperCase());
const showConcepts = process.argv.includes("--concepts");
if (!tickers.length) { console.error("usage: node --import tsx scripts/debt-sweep.ts <TICKER ...> [--concepts]"); process.exit(2); }
let mismatches = 0;
for (const t of tickers) {
  const rawDir = join("data", "raw", t);
  if (!existsSync(rawDir)) { console.log(`${t}: no data/raw/${t}`); continue; }
  const accs = readdirSync(rawDir).filter((d) => existsSync(join(rawDir, d, "edgar-primary.html")));
  for (const acc of accs) {
    const dir = join(rawDir, acc);
    const meta = JSON.parse(readFileSync(join(dir, "edgar-filing.json"), "utf8")) as { form: "10-Q" | "10-K"; filedDate: string };
    let facts: CompanyFactsLike = { facts: { "us-gaap": {} } };
    facts = mergeFilingFacts(facts, parseFilingXbrl(readFileSync(join(dir, "edgar-primary.html"), "utf8"), { form: meta.form, filed: meta.filedDate }));
    const tenK = join(dir, "edgar-10k-primary.html");
    if (existsSync(tenK)) {
      const html = readFileSync(tenK, "utf8");
      const periodEnd = html.match(/name="dei:DocumentPeriodEndDate"[^>]*>\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1] ?? "2000-01-01";
      facts = mergeFilingFacts(facts, parseFilingXbrl(html, { form: "10-K", filed: periodEnd }));
    }
    let sec: ReturnType<typeof parseCompanyFacts>;
    try { sec = parseCompanyFacts(facts); } catch (e) { console.log(`${t} ${acc}: cannot parse (${(e as Error).message})`); continue; }
    const packPath = join("data", "facts", t, `${acc}.json`);
    const pack = existsSync(packPath) ? JSON.parse(readFileSync(packPath, "utf8")) : null;
    const row = (key: string): (number | null)[] => pack?.statements.balance.find((r: { key: string }) => r.key === key)?.values ?? [];
    const years: string[] = pack?.statements.fiscalYears ?? [];
    // EVERY fiscal-year column (review F-10), not only the latest: the 10-K iXBRL carries two balance-sheet years and
    // the 10-Q one; a column the iXBRL does not cover prints "n/a" and is not counted as a mismatch. The 10-K's income,
    // cash-flow and equity statements cover THREE years, so the third-oldest FY row exists (with cash and equity) and
    // no balance sheet behind it. "Has a balance sheet" is therefore keyed on the dates the filer tags total Assets —
    // every filer, banks included, tags it on the face of each balance sheet — never on the debt figure itself, so a
    // debt that regresses to null in a covered year still counts as a mismatch.
    const gaapAll = (facts.facts?.["us-gaap"] ?? {}) as Record<string, { units?: { USD?: { end: string; start?: string }[] } }>;
    const balanceSheetEnds = new Set((gaapAll.Assets?.units?.USD ?? []).filter((e) => !e.start).map((e) => e.end));
    years.forEach((fyLabel, i) => {
      const year = Number("20" + fyLabel.slice(2));
      const fy = sec.annual.find((p) => p.fiscal_year === year);
      const packDebt = row("totalDebt")[i] ?? null, packCash = row("cashAndInvestments")[i] ?? null;
      if (!fy || !balanceSheetEnds.has(fy.report_date)) {
        console.log(`   ${t} ${fyLabel}: iXBRL n/a | pack totalDebt=${packDebt} cash+inv=${packCash}`);
        return;
      }
      const same = fy.total_debt === packDebt;
      if (!same) mismatches++;
      console.log(`${same ? "  " : "! "}${t} ${fyLabel}: iXBRL totalDebt=${fy.total_debt} cash+inv=${fy.cash_and_short_term_investments} netDebt=${fy.net_debt} | pack totalDebt=${packDebt} cash+inv=${packCash}`);
    });
    if (showConcepts) {
      const gaap = (facts.facts?.["us-gaap"] ?? {}) as Record<string, { units?: { USD?: { end: string; start?: string; val: number }[] } }>;
      for (const [c, node] of Object.entries(gaap)) if (/Debt|Borrow|NotesPayable|CommercialPaper/.test(c) && !/Securities|Unrealized|Maturities(Repayments|Within|After)|LineOfCredit|FairValue/.test(c))
        console.log(`     ${c}: ${(node.units?.USD ?? []).filter((e) => !e.start).map((e) => `${e.end}=${e.val / 1e6}`).join(", ")}`);
    }
  }
}
console.log(`\n${mismatches} mismatch(es).`);
process.exitCode = mismatches ? 1 : 0;
