import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceContext } from "@/lib/data";
import { getAgentPerformance } from "@/lib/agent-report";
import { currentUser, isWorkspaceAgent } from "@/lib/permissions";
import { resolveDateRange } from "@/lib/date-range";
import { renderAgentActivityPdf } from "@/lib/pdf/agent-activity-pdf";

export const dynamic = "force-dynamic";

/**
 * Downloads the Agent Activity report as a PDF, honoring the same query
 * params as the on-screen page: range/from/to for the period and agent=<ids>
 * (comma-separated) to narrow it to specific agents.
 */
export async function GET(req: NextRequest) {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { active } = await getWorkspaceContext();
  if (!active)
    return NextResponse.json({ error: "No workspace" }, { status: 404 });
  if (await isWorkspaceAgent(active.id))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const resolved = resolveDateRange(
    {
      range: sp.get("range") ?? undefined,
      from: sp.get("from") ?? undefined,
      to: sp.get("to") ?? undefined,
    },
    { presets: [7, 30, 90], defaultPreset: "30", allowAllTime: false },
  );
  const agentIds = (sp.get("agent") ?? "").split(",").filter(Boolean);

  const report = await getAgentPerformance(active.id, {
    start: resolved.start,
    end: resolved.end,
  });
  const rows =
    agentIds.length > 0
      ? report.rows.filter((r) => agentIds.includes(r.userId))
      : report.rows;

  const pdf = await renderAgentActivityPdf({
    workspaceName: active.name,
    periodLabel: resolved.label,
    generatedAt: new Date(),
    rows,
  });

  const slug = active.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="agent-activity-${slug}-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
