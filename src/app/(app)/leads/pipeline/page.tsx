import { auth } from "@/lib/auth";
import { getWorkspaceContext, getPipeline } from "@/lib/data";
import { canManageWorkspace } from "@/lib/permissions";
import { isRingCentralConnected } from "@/lib/settings";
import { PipelineBoard } from "@/components/app/pipeline-board";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const { active } = await getWorkspaceContext();
  if (!active) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="text-sm text-muted-foreground">No workspace selected.</p>
      </div>
    );
  }

  const session = await auth();
  const [pipeline, canManage] = await Promise.all([
    getPipeline(active.id),
    canManageWorkspace(active.id),
  ]);
  const rcConnected = session?.user?.id
    ? await isRingCentralConnected(session.user.id)
    : false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {active.name} — Pipeline
        </h1>
        <p className="text-sm text-muted-foreground">
          Your sales funnel — move each lead through the stages as you work it.
        </p>
      </div>

      <PipelineBoard
        workspaceId={active.id}
        stages={pipeline.stages}
        cardsByStage={pipeline.cardsByStage}
        counts={pipeline.counts}
        cap={pipeline.cap}
        ringcentralConnected={rcConnected}
        canManage={canManage}
      />
    </div>
  );
}
