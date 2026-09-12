import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Markdown } from "../Markdown";
import { Section } from "../Section";
import { Src } from "../Src";
import { pct, upside, usd } from "@/lib/format";
import type { Report } from "@/lib/report.schema";

export function AnalystSentiment({
  data, current, asOf,
}: { data: Report["analystSentiment"]; current: number; asOf: string }) {
  const u = upside(data.consensusTarget, current);
  const rows: [string, React.ReactNode][] = [
    [`Consensus rating (${data.numAnalysts} analysts)`, data.consensusRating],
    ["Rating distribution", `${data.buy} Buy / ${data.hold} Hold / ${data.sell} Sell`],
    ["Consensus price target", usd(data.consensusTarget)],
    ["Median target", usd(data.medianTarget)],
    ["High / Low target", `${usd(data.highTarget)} / ${usd(data.lowTarget)}`],
    ["Implied upside to consensus",
      <span key="u" className={u >= 0 ? "font-bold text-bull" : "font-bold text-bear"}>
        {pct(u, { signed: true })}
      </span>],
  ];
  return (
    <Section title="Analyst Sentiment Summary">
      <div className="-mx-1 overflow-x-auto px-1">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Metric</TableHead><TableHead>Value</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([k, v]) => (
              <TableRow key={k}><TableCell>{k}</TableCell><TableCell>{v}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Src>Source: Bigdata.com / FMP aggregated analyst data, as of {asOf}.</Src>
      <Markdown text={data.commentary} />
    </Section>
  );
}
