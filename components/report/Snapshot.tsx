import { Fragment } from "react";
import { formatSnapshot } from "@/lib/format";
import type { SnapshotCellData } from "@/lib/report.schema";

export function Snapshot({ cells }: { cells: SnapshotCellData[] }) {
  const rows: (SnapshotCellData | undefined)[][] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push([cells[i], cells[i + 1]]);
  return (
    <table className="my-2 w-full border-collapse font-mono">
      <tbody>
        {rows.map((pair, i) => (
          <tr key={i}>
            {pair.map((cell, j) => (
              <Fragment key={j}>
                <td className="w-[22%] border-b border-hairline py-1.5 pr-2.5 text-left font-sans text-[12.5px] text-muted">
                  {cell?.label ?? ""}
                </td>
                <td className="w-[28%] border-b border-hairline py-1.5 pr-2.5 text-left text-[13px] font-bold text-ink">
                  {cell ? formatSnapshot(cell) : ""}
                </td>
              </Fragment>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
