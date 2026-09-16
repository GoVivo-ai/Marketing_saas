/**
 * One shape every downloadable view is reduced to, so CSV, Excel and PDF all
 * render the same numbers from the same place. Building the table lives with
 * the data (see lib/export/datasets.ts); the three serializers below only
 * know about columns and rows.
 */

export type CellValue = string | number | Date | null;

export interface ExportColumn {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Relative width hint, used by the PDF layout. */
  width?: number;
  /** Renders as currency in Excel and with a $ in CSV/PDF. */
  money?: boolean;
}

export interface ExportTable {
  /** File name stem — the format's extension is appended. */
  filename: string;
  title: string;
  /** Period and filters, shown under the title in the PDF. */
  subtitle: string;
  columns: ExportColumn[];
  rows: Record<string, CellValue>[];
  /** Optional totals row, keyed like `rows`. */
  totals?: Record<string, CellValue>;
}

export const EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(v: string | null): v is ExportFormat {
  return EXPORT_FORMATS.includes(v as ExportFormat);
}

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** How a cell reads in CSV and PDF (Excel keeps the raw value + a format). */
export function formatCell(value: CellValue, col: ExportColumn): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return col.money ? usd(value) : String(value);
  return value;
}

/**
 * RFC 4180 CSV. Prefixed with a BOM by the caller so Excel opens UTF-8 with
 * accents intact — a plain UTF-8 CSV shows "Calexico" fine but mangles names
 * like "Peña".
 */
export function toCsv(table: ExportTable): string {
  const esc = (c: string) =>
    /[",\n\r]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c;
  const line = (cells: string[]) => cells.map(esc).join(",");

  const out = [line(table.columns.map((c) => c.label))];
  for (const row of table.rows) {
    out.push(line(table.columns.map((c) => formatCell(row[c.key] ?? null, c))));
  }
  if (table.totals) {
    out.push(
      line(table.columns.map((c) => formatCell(table.totals![c.key] ?? null, c))),
    );
  }
  return "﻿" + out.join("\r\n");
}
