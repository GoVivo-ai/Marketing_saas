import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Mail,
  Phone,
  Loader2,
  MapPin,
  MapPinOff,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { LeadContactActions } from "@/components/app/lead-contact-actions";
import { LeadActivity } from "@/components/app/lead-activity";
import { LeadDisqualify } from "@/components/app/lead-disqualify";
import { auth } from "@/lib/auth";
import { isAnyTelephonyConnected } from "@/lib/integrations/telephony";
import { getLeadById, getWorkspaceContext, type LeadGeo } from "@/lib/data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const platformLabel: Record<string, string> = {
  meta: "Meta",
  google_ads: "Google Ads",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right font-medium">{value}</span>
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { active } = await getWorkspaceContext();
  if (!active) notFound();

  // A missing lead is usually a stale deep link (e.g. after switching
  // workspaces) — send them back to the inbox rather than a hard 404.
  const lead = await getLeadById(active.id, id);
  if (!lead) redirect("/leads");

  const session = await auth();
  const contactConnected = session?.user?.id
    ? await isAnyTelephonyConnected(session.user.id)
    : false;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/leads"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Leads
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
            <p className="text-sm text-muted-foreground">
              Received {formatDistanceToNow(lead.createdAt, { addSuffix: true })}{" "}
              via {platformLabel[lead.platform] ?? lead.platform}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: lead.stageColor ?? "#94a3b8" }}
              />
              {lead.stageName ?? lead.status}
            </span>
            <Badge variant="outline">
              {platformLabel[lead.platform] ?? lead.platform}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Working area — the activity history. */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <LeadActivity leadId={lead.id} />
            </CardContent>
          </Card>
        </div>

        {/* Context sidebar. */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="flex items-center gap-2 text-sm">
                <Mail className="size-4 shrink-0 text-muted-foreground" />
                {lead.email !== "—" ? (
                  <a href={`mailto:${lead.email}`} className="hover:underline">
                    {lead.email}
                  </a>
                ) : (
                  <span className="text-muted-foreground">No email</span>
                )}
              </p>
              <p className="flex items-center gap-2 text-sm">
                <Phone className="size-4 shrink-0 text-muted-foreground" />
                {lead.phone !== "—" ? (
                  <a href={`tel:${lead.phone}`} className="hover:underline">
                    {lead.phone}
                  </a>
                ) : (
                  <span className="text-muted-foreground">No phone</span>
                )}
              </p>
              <LeadContactActions
                leadId={lead.id}
                hasPhone={lead.phone !== "—"}
                connected={contactConnected}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI Score</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {lead.aiScore != null ? (
                <>
                  <div className="flex items-center gap-2">
                    <Progress value={lead.aiScore} className="h-1.5" />
                    <span className="text-sm font-medium">{lead.aiScore}</span>
                  </div>
                  {lead.aiReason && (
                    <p className="text-sm text-muted-foreground">{lead.aiReason}</p>
                  )}
                  {lead.aiSuggestedAction && (
                    <p className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
                      <span className="font-medium">Suggested: </span>
                      {lead.aiSuggestedAction}
                    </p>
                  )}
                </>
              ) : (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Procesando…
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <LeadDisqualify
                leadId={lead.id}
                current={{
                  l1: lead.disqualL1,
                  l2: lead.disqualL2,
                  l3: lead.disqualL3,
                }}
              />
            </CardContent>
          </Card>

          {lead.geo && lead.geo.status !== "no_target" && (
            <Card>
              <CardContent className="pt-6">
                <LeadArea geo={lead.geo} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <DetailRow label="Campaign" value={lead.campaign} />
              <DetailRow
                label="Assigned to"
                value={
                  lead.assignedTo ?? (
                    <span className="font-normal text-muted-foreground">
                      Unassigned
                    </span>
                  )
                }
              />
              <DetailRow label="Received" value={format(lead.createdAt, "PPp")} />
              <DetailRow
                label="Last updated"
                value={format(lead.updatedAt, "PPp")}
              />
              {lead.externalId && (
                <DetailRow
                  label="Platform ID"
                  value={
                    <span className="break-all font-mono text-xs">
                      {lead.externalId}
                    </span>
                  }
                />
              )}
            </CardContent>
          </Card>

          {lead.formData && Object.keys(lead.formData).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Form responses</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {Object.entries(lead.formData).map(([key, value]) => (
                  <div key={key} className="space-y-0.5">
                    <p className="text-xs capitalize text-muted-foreground">
                      {key.replaceAll("_", " ")}
                    </p>
                    <p className="break-words font-medium">
                      {typeof value === "string" ? value : JSON.stringify(value)}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** Lead's position relative to its ad set's audience radius. */
function LeadArea({ geo }: { geo: LeadGeo }) {
  const cfg = {
    within: { label: "Within radius", cls: "text-success", Icon: MapPin },
    near: { label: "Near the edge", cls: "text-amber-500", Icon: MapPin },
    outside: { label: "Outside area", cls: "text-destructive", Icon: MapPin },
    no_location: { label: "No location in form", cls: "text-muted-foreground", Icon: MapPinOff },
    no_target: { label: "No targeted city", cls: "text-muted-foreground", Icon: MapPinOff },
  }[geo.status];
  const Icon = cfg.Icon;
  const u = geo.unit === "kilometer" ? "km" : "mi";
  const located =
    geo.status === "within" || geo.status === "near" || geo.status === "outside";

  return (
    <div className="space-y-2 text-sm">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Audience area
      </h4>
      <p className={cn("flex items-center gap-1.5 font-medium", cfg.cls)}>
        <Icon className="h-4 w-4" /> {cfg.label}
      </p>
      {located && (
        <div className="space-y-0.5 text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">
              {geo.leadCity ?? "Lead"}
            </span>
            {" → "}
            <span className="font-medium text-foreground">{geo.targetCity}</span>{" "}
            (target)
          </p>
          <p>
            ~{geo.distance} {u} from center · radius {geo.radius} {u}
            {!geo.radiusKnown && " (default)"}
          </p>
        </div>
      )}
      {geo.status === "no_location" && (
        <p className="text-muted-foreground">
          The lead didn&apos;t provide a city
          {geo.targetCity ? `, so we can't place it against ${geo.targetCity}` : ""}.
        </p>
      )}
    </div>
  );
}
