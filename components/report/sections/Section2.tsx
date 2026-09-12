import { Markdown, MD } from "../Markdown";
import { FinTable } from "../FinTable";
import { Section } from "../Section";
import { Src } from "../Src";
import type { Report } from "@/lib/report.schema";

export function Section2({ data }: { data: Report["sections"]["financials"] }) {
  const blocks = [
    { title: "2.1 Income Statement Analysis", table: data.income, commentary: data.incomeCommentary },
    { title: "2.2 Balance Sheet Analysis", table: data.balance, commentary: data.balanceCommentary },
    { title: "2.3 Cash Flow Analysis", table: data.cashflow, commentary: data.cashflowCommentary },
  ];
  return (
    <Section title="2. Financial Performance & Health">
      {blocks.map((b) => (
        <div key={b.title}>
          <h3>{b.title}</h3>
          <FinTable table={b.table} />
          {b.table.note && <Src><MD>{b.table.note}</MD></Src>}
          <Markdown text={b.commentary} />
        </div>
      ))}
    </Section>
  );
}
