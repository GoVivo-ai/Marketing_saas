"use client";

import { useEffect, useState, useTransition } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Loader2,
  MapPin,
  MapPinOff,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { claimLead, markLeadCcActivated } from "@/lib/actions/leads";
import { CC_STATUSES, CC_STATUS_COLOR, CC_STATUS_LABEL, isCcStatus } from "@/lib/cc";
import { Button } from "@/components/ui/button";
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
import { LeadStagePicker } from "@/components/app/lead-stage-picker";
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
  onStageChange,
}: {
  lead: LeadRow | null;
  onClose: () => void;
  /** Reflect inline edits (LeadInfoEditor) back into the caller's state. */
  onPatch?: (patch: Partial<LeadRow>) => void;
  /**
   * Fired after the lead's pipeline stage changed from inside the sheet (the
   * stage picker or the CC section) — the contact queue uses it to drop the
   * lead from today's list without a second manual action.
   */
  onStageChange?: (leadId: string) => void;
}) {
  // Opening a lead soft-claims it (viewing = working) so teammates get a
  // heads-up instead of contacting it too; if someone already holds a live
  // claim, warn — never steal it. Keyed by lead id so a stale warning never
  // carries over to the next lead opened.
  const [claim, setClaim] = useState<{ id: string; by: string } | null>(null);
  const leadId = lead?.id ?? null;
  useEffect(() => {
    let active = true;
    if (!leadId) return;
    claimLead(leadId)
      .then((r) => {
        if (active) setClaim(r.ok ? null : { id: leadId, by: r.by });
      })
      .catch(() => {
        // Best-effort — the detail still opens without the claim.
      });
    return () => {
      active = false;
    };
  }, [leadId]);
  const claimedBy = claim && claim.id === leadId ? claim.by : null;

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
                <LeadStagePicker
                  lead={lead}
                  onPatch={onPatch}
                  onMoved={() => onStageChange?.(lead.id)}
                />
              </SheetTitle>
              <SheetDescription>
                Received {formatDistanceToNow(lead.createdAt, { addSuffix: true })} via{" "}
                {platformLabel[lead.platform] ?? lead.platform}
              </SheetDescription>
              {claimedBy && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                  <span>
                    <span className="font-medium">{claimedBy}</span> is working
                    this lead right now.
                  </span>
                </div>
              )}
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
                <CcActivated
                  key={`cc-${lead.id}`}
                  lead={lead}
                  onPatch={onPatch}
                  onStageChange={onStageChange}
                />
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

                {lead.geo && (lead.geo.status !== "no_target" || lead.geo.leadCity) && (
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

/**
 * The Contractor Compliance section: one click activates the lead in CC
 * (moving it to the compliance stage, out of the contact queue), and once
 * there the sub-pipeline picker tracks where the onboarding stands —
 * Activated → Next Steps Explained → Completing A1s → Abandoned — without
 * the card ever leaving the compliance column.
 */
function CcActivated({
  lead,
  onPatch,
  onStageChange,
}: {
  lead: LeadRow;
  onPatch?: (patch: Partial<LeadRow>) => void;
  onStageChange?: (leadId: string) => void;
}) {
  const [saving, start] = useTransition();
  const current = isCcStatus(lead.ccStatus) ? lead.ccStatus : null;
  const pick = (status: (typeof CC_STATUSES)[number]) =>
    start(async () => {
      const r = await markLeadCcActivated(lead.id, status);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      const moved = lead.stageName !== r.stageName;
      onPatch?.({ ccStatus: status, stageName: r.stageName });
      toast.success(
        moved
          ? `Moved to ${r.stageName} — ${CC_STATUS_LABEL[status]}.`
          : `CC status: ${CC_STATUS_LABEL[status]}.`,
      );
      if (moved) onStageChange?.(lead.id);
    });
  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        Contractor Compliance
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {CC_STATUSES.map((status) => {
          const active = current === status;
          return (
            <Button
              key={status}
              size="sm"
              variant="outline"
              disabled={saving}
              aria-pressed={active}
              className="h-8 gap-1.5 font-normal"
              style={
                active
                  ? {
                      color: CC_STATUS_COLOR[status],
                      borderColor: CC_STATUS_COLOR[status],
                      backgroundColor: `${CC_STATUS_COLOR[status]}14`,
                    }
                  : undefined
              }
              onClick={() => pick(status)}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: CC_STATUS_COLOR[status] }}
              />
              {CC_STATUS_LABEL[status]}
            </Button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Marking any state moves the lead to the compliance stage; the state
        itself tracks the onboarding inside Contractor Compliance.
      </p>
    </div>
  );
}

/** Lead's position relative to its ad set's audience radius. */
function LeadArea({ geo }: { geo: LeadGeo }) {
  // A lead with a city but no ad-set target (e.g. added manually) still gets
  // its location shown — there's just no audience radius to compare against.
  if (geo.status === "no_target") {
    return (
      <div className="space-y-2 text-sm">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Location
        </h4>
        <p className="flex items-center gap-1.5 font-medium">
          <MapPin className="h-4 w-4 text-muted-foreground" /> {geo.leadCity}
          {geo.leadRegion ? `, ${geo.leadRegion}` : ""}
        </p>
      </div>
    );
  }

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
            <span className="font-medium text-foreground">
              {geo.leadCity ?? "Lead"}
              {geo.leadRegion ? `, ${geo.leadRegion}` : ""}
            </span>
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
