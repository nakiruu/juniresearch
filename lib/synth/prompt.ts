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
import { HIGHLIGHT_KEYS } from "../facts/highlights";
import { formatSnapshot, formatCell, compactUSD, compactNum, usd, pct, mult, num, type SnapshotCell } from "../format";
import type { FinancialTable } from "../report.schema";
import type { EditorialReview } from "./editorial.schema";
import { renderEditorialFindings } from "./editorial";

const table = (title: string, t: FinancialTable): string => {
  const head = `| ${t.columns.join(" | ")} |\n| ${t.columns.map(() => "---").join(" | ")} |`;
  const rows = t.rows.map((r) => `| ${r.label} | ${r.values.map((v) => formatCell(v, r.format)).join(" | ")} |`);
  return `### ${title}\n${head}\n${rows.join("\n")}`;
};
const money = (x: number | null) => (x == null ? "—" : compactUSD(x));
const eps = (x: number | null) => (x == null ? "—" : usd(x));
const ratio = (x: number | null, dp = 1) => (x == null ? "—" : pct(x, { dp }));
const multOrDash = (x: number | null) => (x == null ? "—" : mult(x));
const num2OrDash = (x: number | null) => (x == null ? "—" : num(x, 2));

export function renderFactsBlock(facts: ReportFacts, pack: FactPack): string {
  // facts.snapshot is SnapshotCellData, Zod's inferred type from report.schema.ts; format.ts is frozen and
  // declares its own SnapshotCell interface rather than importing that type. The two shapes are structurally
  // identical, so the cast is safe — it just bridges the schema-inferred type to format.ts's hand-declared one.
  const snap = facts.snapshot.map((c) => `- ${c.label}: ${formatSnapshot(c as SnapshotCell)}`).join("\n");
  const e = pack.estimates, t = pack.ttm, a = facts.analystSentiment, lq = pack.latestQuarter;
  const multiples = facts.sections.valuation.multiplesCompanyColumn.map((m) => `- ${m.label}: ${m.value == null ? "—" : mult(m.value)}`).join("\n");
  const grossOfElim = /gross of intersegment eliminations/i.test(facts.sections.businessMoat.segmentsBasis);
  const segments = facts.sections.businessMoat.segments.map((s) => `- ${s.name}: ${pct(s.sharePct)} (${compactUSD(s.revenue)})`).join("\n")
    + (grossOfElim ? "\n- Note: these segment revenues are gross of intersegment eliminations (they include internal sales, e.g. in-house foundry wafers), so they sum above consolidated revenue; the shares are of that gross total. Do not multiply a share by consolidated revenue." : "");
  // Three cases for the geography line: the vendor gave a geographic split (render it); the vendor gave no
  // product split so geography was promoted to the segment mix above (say so, don't repeat it); or a
  // single-jurisdiction issuer with neither (say there is no regional mix to quote).
  const geoPromoted = /by geography/i.test(facts.sections.businessMoat.segmentsBasis);
  const singleSegment = /single reportable segment/i.test(facts.sections.businessMoat.segmentsBasis);
  const geo = facts.sections.businessMoat.geoMix.length
    ? facts.sections.businessMoat.geoMix.map((g) => `- ${g.region}: ${pct(g.sharePct)}`).join("\n")
    : geoPromoted
      ? "- The vendor gives no product split; the geographic revenue mix is shown as the segment mix above."
      : singleSegment
        ? "- The vendor breaks out no product or geographic revenue mix; the company reports as a single segment, shown as the consolidated total above. Do not quote a segment or regional split."
        : "- No geographic split in the vendor data (single-jurisdiction issuer); do not quote a regional mix.";
  const sharesNote = pack.quote.sharesSource === "cover" ? "cover page" : "derived from market cap";
  const highlights = HIGHLIGHT_KEYS.filter((k) => facts.highlightCells[k] != null)
    .map((k) => `- ${k}: ${facts.highlightCells[k]!.label} = ${formatSnapshot(facts.highlightCells[k] as SnapshotCell)}`)
    .join("\n");
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
    `- Net debt/EBITDA ${multOrDash(t.netDebtToEbitda)} · Interest coverage ${multOrDash(t.interestCoverage)} · FCF yield ${ratio(t.fcfYield)} · Current ratio ${num2OrDash(t.currentRatio)}`,
    `- Latest quarter ${lq.label} (ended ${lq.periodEnd}): revenue ${compactUSD(lq.revenue)}, operating margin ${lq.operatingMargin == null ? `not meaningful (${lq.revenue ? "no operating-income line" : "no revenue in the quarter"})` : pct(lq.operatingMargin)}${lq.revenueYoY == null ? "" : `, revenue ${pct(lq.revenueYoY, { signed: true })} YoY`}`,
    "### Multiples (company column; peers pending a peer data source)", multiples,
    "### Street view",
    `- ${a.numAnalysts} analysts: Buy ${a.buy} · Hold ${a.hold} · Sell ${a.sell}; consensus ${a.consensusRating}`,
    `- Targets: consensus ${usd(a.consensusTarget)}, median ${usd(a.medianTarget)}, range ${usd(a.lowTarget)}–${usd(a.highTarget)}`,
    `### Segments (${facts.sections.businessMoat.segmentsBasis})`, segments,
    `### Geography (${facts.sections.businessMoat.geographyBasis})`, geo,
    `### Quote`,
    `- Price ${usd(pack.quote.price)} as of ${pack.quote.asOf}; 52-week ${usd(pack.quote.week52Low)}–${usd(pack.quote.week52High)}; market cap ${compactUSD(pack.quote.marketCap)}; shares ${compactNum(pack.quote.sharesOutstanding)} (${sharesNote}); dividend yield ${pct(pack.quote.dividendYield, { dp: 2 })}`,
    "### Highlight cells you may add (up to four, by key)", highlights,
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
    ex("Earnings press release", c.pressRelease),
    ex("Proxy statement", c.proxyStatement),
    ex("Transcript highlights", c.transcriptHighlights),
    `### Headlines\n${headlines}`,
  ].join("\n\n");
}

const CONTRACT = `- Write Markdown using only: **bold**, "### " or "#### " at the start of a block, "- " list lines, blank lines between paragraphs, and {+ text +} / {- text -} for bullish / bearish spans. No HTML, no links, no images, no tables, and never nest markers (no **{+ +}**).
- Numeric fields (targets, implied prices, probabilities) are plain numbers; probabilities are ratios (0.30, not 30 or "30%").
- Quote figures exactly as they appear in the Facts or Context blocks below — the same rounding, the same unit. Never compute a new figure, never recall one from memory. A figure that appears in neither block fails validation.
- Do not write null anywhere; omit an optional field instead.
- Keep every field within its schema bounds; the page has a fixed shape.
- Order your thinking as the schema orders the fields: rating and scenarios first, then the prose that argues for them.
- Governance claims (board composition and independence, executive pay, insider ownership, related-party dealings) rest on the proxy statement excerpt in Context; when the pack carries no proxy statement, say so in the governance section rather than inferring.`;

const CALLS = `- Scenarios: exactly three, named exactly \`Bull\`, \`Base\`, \`Bear\`, with implied prices Bull ≥ Base ≥ Bear and probabilities that sum to 1.
- Target range: \`targetLow\` < \`targetHigh\`, and the range must bracket the Base implied price.
- Rating: the probability-weighted fair value (Σ impliedPrice × probability) implies an upside vs the current price; your label must sit in its envelope — STRONG BUY ≥ +25%, BUY ≥ +10%, HOLD −10% to +15%, SELL ≤ −5%, STRONG SELL ≤ −20%. A conservative label is allowed; a contradiction fails.
- Numbers you may quote from your own calls: the target range and its upside range, each scenario's weighted value, and the weighted fair value — the page renders these.
- Scenario probabilities are quotable as percentages (e.g. 48%).
- \`highlights\`: up to four keys from the "Highlight cells you may add" list below, no repeats; the code computes the values, you only choose which keys to append.`;

export function renderPrompt(
  pack: FactPack,
  facts: ReportFacts,
  desk: Desk,
  opts: { priorErrors?: string[]; priorWarnings?: string[]; judgmentPath?: string; editorial?: EditorialReview } = {},
): string {
  const path = opts.judgmentPath ?? `data/judgment/${pack.ticker}/${pack.filing.accession}.json`;
  const parts = [
    `# Role\n\nYou are ${desk.analystName} at ${desk.analyst}, writing the judgment half of an equity research report on ${pack.company} (${pack.ticker}) following its ${pack.filing.form} for the period ended ${pack.filing.periodEnd}. House style:\n${desk.styleRules.map((r) => `- ${r}`).join("\n")}`,
    `# Authoring contract\n\n${CONTRACT}`,
    `# Calls\n\n${CALLS}`,
    `# Facts\n\n${renderFactsBlock(facts, pack)}`,
    `# Context\n\n${renderContextBlock(pack)}`,
    `# Output\n\nWrite one JSON object matching this schema, and nothing else, to \`${path}\`. Return the complete object every time.\n\n\`\`\`json\n${JSON.stringify(judgmentJsonSchema(), null, 2)}\n\`\`\``,
  ];
  const errors = opts.priorErrors ?? [];
  const warnings = opts.priorWarnings ?? [];
  if (errors.length || warnings.length) {
    const lead = errors.length
      ? `Your previous object failed validation. Fix every item below and return the full object again.\n${errors.map((e) => `- ${e}`).join("\n")}`
      : "Your previous object passed validation. The desk lint left the warnings below; fix the cheap ones and return the full object again.";
    const tail = warnings.length
      ? `\n\n## Warnings (fix if cheap)\n\nThese do not block the build. Fix the ones a rewrite can absorb; leave the rest.\n${warnings.map((w) => `- ${w}`).join("\n")}`
      : "";
    parts.push(`# Prior errors\n\n${lead}${tail}`);
  }
  if (opts.editorial)
    parts.push(`# Editorial findings\n\n${renderEditorialFindings(opts.editorial)}`);
  return parts.join("\n\n") + "\n";
}
