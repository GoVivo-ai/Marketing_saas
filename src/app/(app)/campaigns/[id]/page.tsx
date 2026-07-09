import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DateRangePicker } from "@/components/app/date-range-picker";
import { AdSetExplorer } from "@/components/app/adset-explorer";
import { CampaignScoringForm } from "@/components/app/campaign-scoring-form";
import {
  getAdSetRows,
  getCampaignById,
  getCampaignFormFields,
  getWorkspaceContext,
} from "@/lib/data";
import { resolveDateRange } from "@/lib/date-range";

export const dynamic = "force-dynamic";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];
const DEFAULT_RANGE = "30";

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const resolved = resolveDateRange(sp, {
    presets: [7, 30, 90],
    defaultPreset: DEFAULT_RANGE,
    allowAllTime: false,
  });

  const { active } = await getWorkspaceContext();
  if (!active) notFound();

  // Missing campaign usually means a stale deep link from another client
  // (e.g. after switching workspaces) — send them to the list, not a 404.
  const campaign = await getCampaignById(active.id, id);
  if (!campaign) redirect("/campaigns");

  const [adsets, formFields] = await Promise.all([
    getAdSetRows(active.id, id, {
      start: resolved.start!,
      end: resolved.end!,
    }),
    getCampaignFormFields(active.id, id),
  ]);
  const totals = adsets.reduce(
    (acc, a) => ({ spend: acc.spend + a.spend, leads: acc.leads + a.leads }),
    { spend: 0, leads: 0 },
  );
  const cities = adsets.filter((a) => a.city).length;
  const cpl = totals.leads > 0 ? totals.spend / totals.leads : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Campaigns
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {campaign.name}
            </h1>
            <Badge variant={campaign.status === "ACTIVE" ? "default" : "secondary"}>
              {campaign.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {cities} cities · {usd(totals.spend)} spent · {totals.leads} leads ·
            CPL {cpl ? usd(cpl) : "—"} · {resolved.label.toLowerCase()}
          </p>
        </div>
        <DateRangePicker
          presets={RANGES}
          defaultValue={DEFAULT_RANGE}
          label={resolved.label}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ad sets by city</CardTitle>
          <CardDescription>
            Each ad set targets a city with an audience radius. The map shows
            that radius; the table shows performance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdSetExplorer adsets={adsets} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI lead scoring</CardTitle>
          <CardDescription>
            Define how the AI should score leads from this campaign. This prompt
            overrides the workspace-wide criteria for this campaign only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignScoringForm
            campaignId={campaign.id}
            scoringCriteria={campaign.scoringCriteria}
            formFields={formFields}
          />
        </CardContent>
      </Card>
    </div>
  );
}
