"use client";

import { format, formatDistanceToNow } from "date-fns";
import { Loader2, MapPin, MapPinOff } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadInfoEditor } from "@/components/app/lead-info-editor";
import { LeadActivity } from "@/components/app/lead-activity";
import { LeadDisqualify } from "@/components/app/lead-disqualify";
import { cn } from "@/lib/utils";
import type { LeadRow, LeadGeo } from "@/lib/data";

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

/**
 * THE lead detail view — activity log, editable contact/form data, AI score,
 * audience area and metadata. Shared by the Leads table and the Pipeline
 * board so every surface opens the same detail.
 */
export function LeadDetailSheet({
  lead,
  onClose,
  onPatch,
}: {
  lead: LeadRow | null;
  onClose: () => void;
  /** Reflect inline edits (LeadInfoEditor) back into the caller's state. */
  onPatch?: (patch: Partial<LeadRow>) => void;
}) {
  return (
    <Sheet open={lead !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl!"
      >
        {lead && (
          <>
            <SheetHeader className="border-b">
              <SheetTitle className="flex items-center gap-2">
                {lead.name}
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: lead.stageColor ?? "#94a3b8" }}
                  />
                  {lead.stageName ?? lead.status}
                </span>
              </SheetTitle>
              <SheetDescription>
                Received {formatDistanceToNow(lead.createdAt, { addSuffix: true })} via{" "}
                {platformLabel[lead.platform] ?? lead.platform}
              </SheetDescription>
            </SheetHeader>

            <Tabs
              defaultValue="activity"
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              <TabsList className="mx-4 mt-4 w-[calc(100%-2rem)]">
                <TabsTrigger value="activity">Activity</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
              </TabsList>

              {/* Working area — log calls, notes and the disqualification reason. */}
              <TabsContent
                value="activity"
                className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pt-4 pb-6"
              >
                <LeadActivity key={lead.id} leadId={lead.id} />
                <Separator />
                <LeadDisqualify
                  key={`dq-${lead.id}`}
                  leadId={lead.id}
                  current={{
                    l1: lead.disqualL1,
                    l2: lead.disqualL2,
                    l3: lead.disqualL3,
                  }}
                />
              </TabsContent>

              {/* Reference — contact, score, area and the raw form. */}
              <TabsContent
                value="details"
                className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pt-4 pb-6"
              >
                <LeadInfoEditor
                  key={lead.id}
                  lead={lead}
                  onSaved={(patch) => onPatch?.(patch)}
                />

                <Separator />

                <div className="space-y-2">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    AI Score
                  </h4>
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
                </div>

                {lead.geo && lead.geo.status !== "no_target" && (
                  <>
                    <Separator />
                    <LeadArea geo={lead.geo} />
                  </>
                )}

                <Separator />

                <div className="space-y-2 text-sm">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Details
                  </h4>
                  <DetailRow label="Campaign" value={lead.campaign} />
                  <DetailRow
                    label="Assigned to"
                    value={
                      lead.assignedTo ?? (
                        <span className="font-normal text-muted-foreground">Unassigned</span>
                      )
                    }
                  />
                  <DetailRow label="Received" value={format(lead.createdAt, "PPp")} />
                  <DetailRow label="Last updated" value={format(lead.updatedAt, "PPp")} />
                  {lead.externalId && (
                    <DetailRow
                      label="Platform ID"
                      value={<span className="break-all font-mono text-xs">{lead.externalId}</span>}
                    />
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
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
  const located = geo.status === "within" || geo.status === "near" || geo.status === "outside";

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
            <span className="font-medium text-foreground">{geo.leadCity ?? "Lead"}</span>
            {" → "}
            <span className="font-medium text-foreground">{geo.targetCity}</span> (target)
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
