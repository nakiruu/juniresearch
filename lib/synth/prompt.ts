/**
 * prompt.ts — the one document the synthesis model reads.
 * ---------------------------------------------------------------------------
 * Facts are rendered through lib/format.ts exactly as the page will show them,
 * so the model can quote them without arithmetic and the grounding index (built
 * from the same strings) accepts every quoted figure. Context is verbatim.
 * Pure: same inputs, same text.
 */
import type { FactPack } from "../facts/schema";
import type { ReportFacts } from "../facts/project";
import type { Desk } from "./desk.schema";
import { judgmentJsonSchema } from "./judgment.schema";
import { formatSnapshot, formatCell, compactUSD, usd, pct, mult, type SnapshotCell } from "../format";
import type { FinancialTable } from "../report.schema";

const table = (title: string, t: FinancialTable): string => {
  const head = `| ${t.columns.join(" | ")} |\n| ${t.columns.map(() => "---").join(" | ")} |`;
  const rows = t.rows.map((r) => `| ${r.label} | ${r.values.map((v) => formatCell(v, r.format)).join(" | ")} |`);
  return `### ${title}\n${head}\n${rows.join("\n")}`;
};
const money = (x: number | null) => (x == null ? "—" : compactUSD(x));
const eps = (x: number | null) => (x == null ? "—" : usd(x));
const ratio = (x: number | null, dp = 1) => (x == null ? "—" : pct(x, { dp }));

export function renderFactsBlock(facts: ReportFacts, pack: FactPack): string {
  const snap = facts.snapshot.map((c) => `- ${c.label}: ${formatSnapshot(c as SnapshotCell)}`).join("\n");
  const e = pack.estimates, t = pack.ttm, a = facts.analystSentiment, lq = pack.latestQuarter;
  const multiples = facts.sections.valuation.multiplesCompanyColumn.map((m) => `- ${m.label}: ${m.value == null ? "—" : mult(m.value)}`).join("\n");
  const segments = facts.sections.businessMoat.segments.map((s) => `- ${s.name}: ${pct(s.sharePct)} (${compactUSD(s.revenue)})`).join("\n");
  const geo = facts.sections.businessMoat.geoMix.map((g) => `- ${g.region}: ${pct(g.sharePct)}`).join("\n");
  return [
    "### Snapshot", snap,
    table(`Income statement (${facts.sections.financials.income.columns.slice(1).join(", ")})`, facts.sections.financials.income),
    table("Balance sheet ($B)", facts.sections.financials.balance),
    table("Cash flow ($B)", facts.sections.financials.cashflow),
    "### Estimates (consensus means)",
    `- ${e.nextFY.label} revenue ${money(e.nextFY.revenue)}, EPS ${eps(e.nextFY.eps)}`,
    `- ${e.followingFY.label} revenue ${money(e.followingFY.revenue)}, EPS ${eps(e.followingFY.eps)}`,
    "### Trailing twelve months",
    `- Gross margin ${ratio(t.grossMargin)} · Operating margin ${ratio(t.operatingMargin)} · Net margin ${ratio(t.netMargin)}`,
    `- Latest quarter ${lq.label} (ended ${lq.periodEnd}): revenue ${compactUSD(lq.revenue)}, operating margin ${pct(lq.operatingMargin)}${lq.revenueYoY == null ? "" : `, revenue ${pct(lq.revenueYoY, { signed: true })} YoY`}`,
    "### Multiples (company column; peers pending a peer data source)", multiples,
    "### Street view",
    `- ${a.numAnalysts} analysts: Buy ${a.buy} · Hold ${a.hold} · Sell ${a.sell}; consensus ${a.consensusRating}`,
    `- Targets: consensus ${usd(a.consensusTarget)}, median ${usd(a.medianTarget)}, range ${usd(a.lowTarget)}–${usd(a.highTarget)}`,
    `### Segments (${facts.sections.businessMoat.segmentsBasis})`, segments,
    `### Geography (${facts.sections.businessMoat.geographyBasis})`, geo,
    `### Quote`,
    `- Price ${usd(pack.quote.price)} as of ${pack.quote.asOf}; 52-week ${usd(pack.quote.week52Low)}–${usd(pack.quote.week52High)}; market cap ${compactUSD(pack.quote.marketCap)}; dividend yield ${pct(pack.quote.dividendYield, { dp: 2 })}`,
  ].join("\n\n");
}

export function renderContextBlock(pack: FactPack): string {
  const c = pack.context;
  const ex = (title: string, e: { text: string; source: string; asOf: string; truncated?: boolean } | null) =>
    e ? `### ${title} (${e.source}, ${e.asOf}${e.truncated ? ", truncated" : ""})\n${e.text}` : `### ${title}\n(not captured)`;
  const headlines = c.headlines.length
    ? c.headlines.map((h) => `- ${h.asOf} · ${h.source.replace(/^bigdata:/, "")} · ${h.text}`).join("\n")
    : "(none captured)";
  return [
    ex("Company description", c.description),
    ex("MD&A", c.mdaExcerpt),
    ex("Risk factors", c.riskFactorsExcerpt),
    ex("Transcript highlights", c.transcriptHighlights),
    `### Headlines\n${headlines}`,
  ].join("\n\n");
}

const CONTRACT = `- Write Markdown using only: **bold**, "### " or "#### " at the start of a block, "- " list lines, blank lines between paragraphs, and {+ text +} / {- text -} for bullish / bearish spans. No HTML, no links, no images, no tables, and never nest markers (no **{+ +}**).
- Numeric fields (targets, implied prices, probabilities) are plain numbers; probabilities are ratios (0.30, not 30 or "30%").
- Quote figures exactly as they appear in the Facts or Context blocks below — the same rounding, the same unit. Never compute a new figure, never recall one from memory. A figure that appears in neither block fails validation.
- Do not write null anywhere; omit an optional field instead.
- Keep every field within its schema bounds; the page has a fixed shape.
- Order your thinking as the schema orders the fields: rating and scenarios first, then the prose that argues for them.`;

export function renderPrompt(pack: FactPack, facts: ReportFacts, desk: Desk, opts: { priorErrors?: string[]; judgmentPath?: string } = {}): string {
  const path = opts.judgmentPath ?? `data/judgment/${pack.ticker}/${pack.filing.accession}.json`;
  const parts = [
    `# Role\n\nYou are ${desk.analystName} at ${desk.analyst}, writing the judgment half of an equity research report on ${pack.company} (${pack.ticker}) following its ${pack.filing.form} for the period ended ${pack.filing.periodEnd}. House style:\n${desk.styleRules.map((r) => `- ${r}`).join("\n")}`,
    `# Authoring contract\n\n${CONTRACT}`,
    `# Facts\n\n${renderFactsBlock(facts, pack)}`,
    `# Context\n\n${renderContextBlock(pack)}`,
    `# Output\n\nWrite one JSON object matching this schema, and nothing else, to \`${path}\`. Return the complete object every time.\n\n\`\`\`json\n${JSON.stringify(judgmentJsonSchema(), null, 2)}\n\`\`\``,
  ];
  if (opts.priorErrors?.length)
    parts.push(`# Prior errors\n\nYour previous object failed validation. Fix every item below and return the full object again.\n${opts.priorErrors.map((e) => `- ${e}`).join("\n")}`);
  return parts.join("\n\n") + "\n";
}
