import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCell } from "@/lib/format";
import type { FinancialTable } from "@/lib/report.schema";

export function FinTable({ table }: { table: FinancialTable }) {
  const emphasize = table.rows.some((r) => r.emphasize);
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <Table>
        <TableHeader>
          <TableRow>
            {table.columns.map((c) => <TableHead key={c}>{c}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((row, i) => (
            <TableRow
              key={row.label}
              className={emphasize && i === table.rows.length - 1 ? "font-bold" : undefined}
            >
              <TableCell>{row.label}</TableCell>
              {row.values.map((v, j) => (
                <TableCell key={j}>{formatCell(v, row.format)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
