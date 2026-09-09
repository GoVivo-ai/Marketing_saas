import Link from "next/link";
import { ArrowLeft, Sparkles } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CampaignScoringForm } from "@/components/app/campaign-scoring-form";
import {
  getCampaignById,
  getCampaignFormFields,
  getPromptTemplates,
  getScoringTargets,
  getWorkspaceContext,
  getWorkspaceScoringCriteria,
} from "@/lib/data";
import { requireFullAccess } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The AI lead-scoring prompt, managed from the Contact Queue (ops meeting
 * 2026-09-04: it lived under Campaigns, where the people who order the queue
 * never saw it). Supervisors and admins only — agents are sent back to the
 * queue by requireFullAccess.
 *
 * One prompt is edited at a time: the workspace default, or a single
 * campaign's override (?campaign=). Re-scoring stays per campaign, so a
 * prompt change can never re-score the whole lead base at once.
 */
export default async function QueueScoringPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  const { active } = await getWorkspaceContext();
  await requireFullAccess(active?.id);
  if (!active) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">AI lead scoring</h1>
        <p className="text-sm text-muted-foreground">No workspace selected.</p>
      </div>
    );
  }

  const sp = await searchParams;
  const [targets, workspaceCriteria, templates] = await Promise.all([
    getScoringTargets(active.id),
    getWorkspaceScoringCriteria(active.id),
    getPromptTemplates(active.id),
  ]);

  // A stale ?campaign= (other workspace, deleted) falls back to the default.
  const campaign = sp.campaign
    ? await getCampaignById(active.id, sp.campaign)
    : null;
  const formFields = campaign
    ? await getCampaignFormFields(active.id, campaign.id)
    : [];
  const overrides = targets.filter((t) => t.hasCriteria).length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/leads/queue"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Contact Queue
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-5 w-5 text-primary" />
          AI lead scoring
        </h1>
        <p className="text-sm text-muted-foreground">
          The prompt the AI scores new leads with. The Contact Queue orders
          new leads by that score, so this is where you decide what the team
          calls first.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Which prompt: the workspace default, or one campaign's override. */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Prompt</CardTitle>
            <CardDescription>
              {overrides === 0
                ? "Every campaign uses the workspace prompt."
                : `${overrides} campaign${overrides === 1 ? "" : "s"} with an own prompt.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <TargetLink
              href="/leads/queue/scoring"
              active={!campaign}
              name="Workspace default"
              hint={workspaceCriteria ? "Set" : "Not set"}
            />
            <p className="px-2 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Per campaign
            </p>
            {targets.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                No campaigns with leads yet.
              </p>
            )}
            {targets.map((t) => (
              <TargetLink
                key={t.id}
                href={`/leads/queue/scoring?campaign=${t.id}`}
                active={campaign?.id === t.id}
                name={t.name}
                hint={`${t.leads} lead${t.leads === 1 ? "" : "s"}`}
                badge={t.hasCriteria ? "Own prompt" : null}
                muted={t.status !== "ACTIVE"}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {campaign ? campaign.name : "Workspace default"}
            </CardTitle>
            <CardDescription>
              {campaign
                ? "Overrides the workspace prompt for this campaign's leads only. Clear it to fall back to the default."
                : "Used by every campaign that has no prompt of its own."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CampaignScoringForm
              key={campaign?.id ?? "workspace"}
              campaignId={campaign?.id ?? null}
              workspaceId={active.id}
              scoringCriteria={
                campaign ? campaign.scoringCriteria : workspaceCriteria
              }
              formFields={formFields}
              templates={templates}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TargetLink({
  href,
  active,
  name,
  hint,
  badge,
  muted,
}: {
  href: string;
  active: boolean;
  name: string;
  hint: string;
  badge?: string | null;
  muted?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted",
        active && "bg-muted font-medium",
        muted && !active && "text-muted-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {badge && (
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {badge}
        </Badge>
      )}
      <span className="shrink-0 text-xs text-muted-foreground">{hint}</span>
    </Link>
  );
}
