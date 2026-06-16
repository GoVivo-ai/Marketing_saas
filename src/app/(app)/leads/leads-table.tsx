"use client";

import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { Mail, Phone, Loader2, MapPin, MapPinOff } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { LeadContactActions } from "@/components/app/lead-contact-actions";
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

export function LeadsTable({
  rows,
  contactConnected,
}: {
  rows: LeadRow[];
  contactConnected: boolean;
}) {
  const [selected, setSelected] = useState<LeadRow | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lead</TableHead>
            <TableHead>Campaign</TableHead>
            <TableHead>AI Score</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead className="text-right">Received</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((lead) => (
            <TableRow
              key={lead.id}
              className="cursor-pointer"
              onClick={() => setSelected(lead)}
            >
              <TableCell>
                <p className="font-medium">{lead.name}</p>
                <p className="text-xs text-muted-foreground">
                  {lead.email} · {lead.phone}
                </p>
              </TableCell>
              <TableCell className="max-w-[220px] truncate text-sm">
                {lead.campaign}
              </TableCell>
              <TableCell>
                {lead.aiScore != null ? (
                  <>
                    <div className="flex w-32 items-center gap-2">
                      <Progress value={lead.aiScore} className="h-1.5" />
                      <span className="w-7 text-sm font-medium">{lead.aiScore}</span>
                    </div>
                    {lead.aiReason && (
                      <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">
                        {lead.aiReason}
                      </p>
                    )}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Procesando…
                  </span>
                )}
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: lead.stageColor ?? "#94a3b8" }}
                  />
                  {lead.stageName ?? lead.status}
                </span>
                {lead.disqualL3 && (
                  <p className="mt-1 max-w-[200px] truncate text-xs text-destructive">
                    {lead.disqualL3}
                  </p>
                )}
              </TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">
                {formatDistanceToNow(lead.createdAt, { addSuffix: true })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="overflow-x-hidden overflow-y-auto sm:max-w-md">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.name}</SheetTitle>
                <SheetDescription>
                  Received {formatDistanceToNow(selected.createdAt, { addSuffix: true })} via{" "}
                  {platformLabel[selected.platform] ?? selected.platform}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-6 px-4 pb-6">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: selected.stageColor ?? "#94a3b8" }}
                    />
                    {selected.stageName ?? selected.status}
                  </span>
                  <Badge variant="outline">
                    {platformLabel[selected.platform] ?? selected.platform}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Contact
                  </h4>
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-2">
                      <Mail className="size-4 shrink-0 text-muted-foreground" />
                      {selected.email !== "—" ? (
                        <a href={`mailto:${selected.email}`} className="hover:underline">
                          {selected.email}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">No email</span>
                      )}
                    </p>
                    <p className="flex items-center gap-2">
                      <Phone className="size-4 shrink-0 text-muted-foreground" />
                      {selected.phone !== "—" ? (
                        <a href={`tel:${selected.phone}`} className="hover:underline">
                          {selected.phone}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">No phone</span>
                      )}
                    </p>
                  </div>
                  <LeadContactActions
                    leadId={selected.id}
                    hasPhone={selected.phone !== "—"}
                    connected={contactConnected}
                  />
                </div>

                <Separator />

                <LeadActivity key={selected.id} leadId={selected.id} />

                <Separator />

                <LeadDisqualify
                  key={`dq-${selected.id}`}
                  leadId={selected.id}
                  current={{
                    l1: selected.disqualL1,
                    l2: selected.disqualL2,
                    l3: selected.disqualL3,
                  }}
                />

                <Separator />

                <div className="space-y-2">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    AI Score
                  </h4>
                  {selected.aiScore != null ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Progress value={selected.aiScore} className="h-1.5" />
                        <span className="text-sm font-medium">{selected.aiScore}</span>
                      </div>
                      {selected.aiReason && (
                        <p className="text-sm text-muted-foreground">{selected.aiReason}</p>
                      )}
                      {selected.aiSuggestedAction && (
                        <p className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
                          <span className="font-medium">Suggested: </span>
                          {selected.aiSuggestedAction}
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

                {selected.geo && selected.geo.status !== "no_target" && (
                  <>
                    <Separator />
                    <LeadArea geo={selected.geo} />
                  </>
                )}

                <Separator />

                <div className="space-y-2 text-sm">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Details
                  </h4>
                  <DetailRow label="Campaign" value={selected.campaign} />
                  <DetailRow
                    label="Assigned to"
                    value={
                      selected.assignedTo ?? (
                        <span className="font-normal text-muted-foreground">Unassigned</span>
                      )
                    }
                  />
                  <DetailRow
                    label="Received"
                    value={format(selected.createdAt, "PPp")}
                  />
                  <DetailRow
                    label="Last updated"
                    value={format(selected.updatedAt, "PPp")}
                  />
                  {selected.externalId && (
                    <DetailRow
                      label="Platform ID"
                      value={<span className="break-all font-mono text-xs">{selected.externalId}</span>}
                    />
                  )}
                </div>

                {selected.formData && Object.keys(selected.formData).length > 0 && (
                  <>
                    <Separator />
                    <div className="space-y-3 text-sm">
                      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Form responses
                      </h4>
                      {Object.entries(selected.formData).map(([key, value]) => (
                        <div key={key} className="space-y-0.5">
                          <p className="text-xs capitalize text-muted-foreground">
                            {key.replaceAll("_", " ")}
                          </p>
                          <p className="break-words font-medium">
                            {typeof value === "string" ? value : JSON.stringify(value)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
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
