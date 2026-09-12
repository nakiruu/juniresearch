import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCell } from "@/lib/format";
import type { FinancialTable } from "@/lib/report.schema";

export function FinTable({ table }: { table: FinancialTable }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {table.columns.map((c) => <TableHead key={c}>{c}</TableHead>)}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.rows.map((row) => (
          <TableRow key={row.label} className={row.emphasize ? "font-bold" : undefined}>
            <TableCell>{row.label}</TableCell>
            {row.values.map((v, j) => (
              <TableCell key={j}>{formatCell(v, row.format)}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
