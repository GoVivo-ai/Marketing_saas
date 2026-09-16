import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/data";
import {
  currentUser,
  isOperations,
  isWorkspaceAgent,
} from "@/lib/permissions";
import {
  buildExportTable,
  isExportDataset,
  type ExportDataset,
} from "@/lib/export/datasets";
import {
  EXPORT_CONTENT_TYPES,
  isExportFormat,
  toCsv,
  type ExportFormat,
} from "@/lib/export/table";
import { toXlsx } from "@/lib/export/xlsx";
import { toPdf } from "@/lib/export/pdf";

export const dynamic = "force-dynamic";

/**
 * Downloads any table in the product as CSV, Excel or PDF.
 *
 * The query string is the page's own — range/from/to plus whatever that view
 * filters by — so the file matches what the person is looking at. One handler
 * for every dataset keeps auth, file naming and the three formats in a single
 * place instead of six near-identical endpoints.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ dataset: string }> },
) {
  const { dataset } = await params;
  if (!isExportDataset(dataset))
    return NextResponse.json({ error: "Unknown dataset" }, { status: 404 });

  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  if (!isExportFormat(format))
    return NextResponse.json({ error: "Unknown format" }, { status: 400 });

  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { active } = await getWorkspaceContext();
  if (!active)
    return NextResponse.json({ error: "No workspace" }, { status: 404 });

  if (!(await canExport(dataset, active.id, u.role)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const table = await buildExportTable(
    dataset,
    { workspaceId: active.id, workspaceName: active.name },
    req.nextUrl.searchParams,
  );
  const body = await serialize(table, format);

  return new NextResponse(body as BodyInit, {
    headers: {
      "Content-Type": EXPORT_CONTENT_TYPES[format],
      "Content-Disposition": `attachment; filename="${table.filename}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Mirrors each page's own guard — a download can't reveal a page you can't open. */
async function canExport(
  dataset: ExportDataset,
  workspaceId: string,
  role: string,
): Promise<boolean> {
  const operations = isOperations(role);
  // Dispatch-only users see the driver board and nothing else.
  if (dataset === "dispatch") return operations || !(await isWorkspaceAgent(workspaceId));
  if (operations) return false;
  // Leads and pipeline are open to agents; the rest is supervisors and up.
  if (dataset === "leads" || dataset === "pipeline") return true;
  return !(await isWorkspaceAgent(workspaceId));
}

async function serialize(
  table: Awaited<ReturnType<typeof buildExportTable>>,
  format: ExportFormat,
): Promise<string | Uint8Array> {
  switch (format) {
    case "csv":
      return toCsv(table);
    case "xlsx":
      return toXlsx(table);
    case "pdf":
      return new Uint8Array(await toPdf(table));
  }
}
