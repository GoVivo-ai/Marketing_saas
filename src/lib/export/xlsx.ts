import ExcelJS from "exceljs";
import type { ExportTable } from "./table";

const NAVY = "FF011640";

/**
 * Real .xlsx (not a CSV with the wrong extension), so numbers land as numbers
 * and the team can pivot them. Header is frozen and filterable; money columns
 * carry a currency format instead of a pre-formatted string.
 */
export async function toXlsx(table: ExportTable): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Vivo MarTech";
  wb.created = new Date();

  // Excel rejects sheet names over 31 chars or containing : \ / ? * [ ]
  const sheetName = table.title.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);
  const ws = wb.addWorksheet(sheetName);

  ws.columns = table.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.width ?? Math.max(12, c.label.length + 4),
    style: {
      alignment: { horizontal: c.align ?? "left" },
      ...(c.money ? { numFmt: '"$"#,##0.00' } : {}),
    },
  }));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  header.alignment = { vertical: "middle" };
  header.height = 20;

  for (const row of table.rows) ws.addRow(row);

  if (table.totals) {
    const totals = ws.addRow(table.totals);
    totals.font = { bold: true };
    totals.border = { top: { style: "thin" } };
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: table.columns.length },
  };

  // ExcelJS declares its own Buffer type; normalize to the bytes a Response
  // can take directly.
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
