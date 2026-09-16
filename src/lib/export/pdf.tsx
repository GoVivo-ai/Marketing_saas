import { renderToBuffer } from "@react-pdf/renderer";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatCell, type ExportTable } from "./table";

/**
 * A PDF is for reading, not for holding a database. Rendering is roughly
 * linear in rows and gets slow fast, so long tables are cut off here and the
 * header says so — CSV and Excel carry the whole set.
 */
export const PDF_ROW_CAP = 800;

/**
 * Generic table PDF — the "something I can read on a tablet or hand to a
 * client" export, as opposed to the CSV you feed to a spreadsheet. Landscape
 * so wide tables keep their columns, repeating header, page numbers.
 *
 * Colours come from the Vivo design system (Navy #011640 is the brand's
 * primary; grey carries the rest — the blue is an accent, not a wash).
 */

const NAVY = "#011640";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const ZEBRA = "#f8fafc";

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: "Helvetica", color: "#0f172a" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", color: NAVY },
  subtitle: { fontSize: 9, color: MUTED, marginTop: 3 },
  brand: { fontSize: 10, fontFamily: "Helvetica-Bold", color: NAVY },
  rule: { borderBottomWidth: 2, borderBottomColor: NAVY, marginVertical: 9 },
  th: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: NAVY,
    paddingBottom: 4,
  },
  thCell: { fontFamily: "Helvetica-Bold", fontSize: 8, color: NAVY },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    paddingVertical: 4,
  },
  totals: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: NAVY,
    paddingTop: 5,
    marginTop: 2,
  },
  totalsCell: { fontFamily: "Helvetica-Bold", fontSize: 8, color: NAVY },
  empty: { marginTop: 24, textAlign: "center", color: MUTED, fontSize: 10 },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 28,
    right: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: MUTED,
  },
});

function TablePdf({
  table,
  generatedAt,
}: {
  table: ExportTable;
  generatedAt: Date;
}) {
  // Columns share the width in proportion to their hints, so a long "Ad set"
  // column isn't squeezed to the same size as a two-digit count.
  const widths = table.columns.map((c) => c.width ?? 10);
  const total = widths.reduce((a, b) => a + b, 0);
  const flex = (i: number) => ({
    width: `${(widths[i] / total) * 100}%`,
    // Gutter, so a right-aligned number never runs into the next column.
    paddingRight: 5,
  });
  const align = (i: number) =>
    ({ textAlign: table.columns[i].align ?? "left" }) as const;
  const rows = table.rows.slice(0, PDF_ROW_CAP);
  const truncated = table.rows.length - rows.length;

  return (
    <Document title={table.title}>
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.title}>{table.title}</Text>
            <Text style={styles.subtitle}>
              {table.subtitle}
              {truncated > 0
                ? ` · first ${PDF_ROW_CAP} of ${table.rows.length} rows — download CSV or Excel for all of them`
                : ""}
            </Text>
          </View>
          <Text style={styles.brand}>Vivo</Text>
        </View>
        <View style={styles.rule} fixed />

        <View style={styles.th} fixed>
          {table.columns.map((c, i) => (
            <Text key={c.key} style={[styles.thCell, flex(i), align(i)]}>
              {c.label}
            </Text>
          ))}
        </View>

        {rows.length === 0 && (
          <Text style={styles.empty}>No rows match these filters.</Text>
        )}

        {rows.map((row, r) => (
          <View
            key={r}
            style={[styles.tr, r % 2 === 1 ? { backgroundColor: ZEBRA } : {}]}
          >
            {table.columns.map((c, i) => (
              <Text key={c.key} style={[flex(i), align(i)]}>
                {formatCell(row[c.key] ?? null, c)}
              </Text>
            ))}
          </View>
        ))}

        {table.totals && (
          <View style={styles.totals}>
            {table.columns.map((c, i) => (
              <Text key={c.key} style={[styles.totalsCell, flex(i), align(i)]}>
                {formatCell(table.totals![c.key] ?? null, c)}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>Generated {generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export function toPdf(table: ExportTable): Promise<Buffer> {
  return renderToBuffer(<TablePdf table={table} generatedAt={new Date()} />);
}
