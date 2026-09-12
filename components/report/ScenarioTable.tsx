import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { MD } from "./Markdown";
import { computeScenarios, pct, usd } from "@/lib/format";
import type { Report } from "@/lib/report.schema";

type Scenarios = Report["sections"]["valuation"]["scenarios"];

export function ScenarioTable({ scenarios }: { scenarios: Scenarios }) {
  const { rows, fairValue } = computeScenarios(scenarios);
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <Table>
        <TableHeader>
          <TableRow>
            {["Scenario", "Driver", "Implied Price", "Prob.", "Weighted"].map((c) => (
              <TableHead key={c}>{c}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.name}>
              <TableCell>{r.name}</TableCell>
              <TableCell><MD>{r.driver}</MD></TableCell>
              <TableCell>{usd(r.impliedPrice, 0)}</TableCell>
              <TableCell>{pct(r.probability, { dp: 0 })}</TableCell>
              <TableCell>{usd(r.weighted)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="font-bold">
            <TableCell>Probability-Weighted Fair Value</TableCell>
            <TableCell /><TableCell /><TableCell />
            <TableCell>{usd(fairValue)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
