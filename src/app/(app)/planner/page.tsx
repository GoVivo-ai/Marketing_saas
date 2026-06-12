import {
  getPlannerData,
  getPlannerHistory,
  getWorkspaceContext,
} from "@/lib/data";
import { PlannerView } from "@/components/app/planner-view";
import { PlannerHistory } from "@/components/app/planner-history";

export const dynamic = "force-dynamic";

/** Resolve a "YYYY-MM" param to the first day of that month, default current. */
function parseMonth(m?: string): Date {
  const now = new Date();
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    const [y, mo] = m.split("-").map(Number);
    if (mo >= 1 && mo <= 12) return new Date(y, mo - 1, 1);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export default async function PlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; plan?: string }>;
}) {
  const { month, plan } = await searchParams;
  const monthStart = parseMonth(month);
  const { active } = await getWorkspaceContext();

  const loaded = active
    ? await Promise.all([
        getPlannerData(active.id, monthStart, plan),
        getPlannerHistory(active.id),
      ])
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {active ? `${active.name} — Planner` : "Planner"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Plan the month by city — goals, leads and budget — then compare it
          against what was actually executed.
        </p>
      </div>

      {active && loaded ? (
        <>
          {/* Keyed so the canvas state resets when the plan or month changes. */}
          <PlannerView
            key={`${active.id}:${loaded[0].month}:${loaded[0].plan.id ?? "draft"}`}
            workspaceId={active.id}
            data={loaded[0]}
          />
          <PlannerHistory
            workspaceId={active.id}
            rows={loaded[1]}
            resultLabel={loaded[0].resultLabel}
          />
        </>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Select a client to start planning.
        </p>
      )}
    </div>
  );
}
