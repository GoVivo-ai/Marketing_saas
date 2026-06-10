"use client";

import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { Mail, Phone } from "lucide-react";
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
import type { LeadRow } from "@/lib/data";

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  new: "default",
  contacted: "secondary",
  qualified: "outline",
  won: "default",
  lost: "destructive",
};

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
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export function LeadsTable({ rows }: { rows: LeadRow[] }) {
  const [selected, setSelected] = useState<LeadRow | null>(null);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lead</TableHead>
            <TableHead>Campaign</TableHead>
            <TableHead>AI Score</TableHead>
            <TableHead>Status</TableHead>
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
                  <span className="text-xs text-muted-foreground">Pending</span>
                )}
              </TableCell>
              <TableCell>
                <Badge
                  variant={statusVariant[lead.status] ?? "secondary"}
                  className="capitalize"
                >
                  {lead.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">
                {formatDistanceToNow(lead.createdAt, { addSuffix: true })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
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
                  <Badge
                    variant={statusVariant[selected.status] ?? "secondary"}
                    className="capitalize"
                  >
                    {selected.status}
                  </Badge>
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
                </div>

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
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Pending scoring</p>
                  )}
                </div>

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
                    <div className="space-y-2 text-sm">
                      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Form responses
                      </h4>
                      {Object.entries(selected.formData).map(([key, value]) => (
                        <DetailRow
                          key={key}
                          label={key.replaceAll("_", " ")}
                          value={typeof value === "string" ? value : JSON.stringify(value)}
                        />
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
