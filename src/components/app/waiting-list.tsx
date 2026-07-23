"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { Clock, Loader2, Phone } from "lucide-react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { LeadDetailSheet } from "@/components/app/lead-detail-sheet";
import { getLeadDetail } from "@/lib/actions/leads";
import type { LeadRow, WaitingItem } from "@/lib/data";

const channelLabel: Record<string, string> = {
  call: "Call",
  sms: "SMS",
  email: "Email",
  whatsapp: "WhatsApp",
};

/**
 * Leads inside the follow-up window ("Waiting"). They were contacted recently
 * and re-enter the queue on their own once the window elapses — but agents can
 * still open any of them to act right away (log a touch, edit info, move
 * stage): clicking a row opens the same LeadDetailSheet the queue uses.
 */
export function WaitingList({ items }: { items: WaitingItem[] }) {
  const [detail, setDetail] = useState<LeadRow | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [, startDetail] = useTransition();

  const openDetail = (leadId: string) => {
    setLoadingId(leadId);
    startDetail(async () => {
      const row = await getLeadDetail(leadId);
      setLoadingId(null);
      if (row) setDetail(row);
      else toast.error("Couldn't load the lead's details.");
    });
  };

  if (!items.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <Clock className="h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No leads waiting.</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Leads you contact appear here during the follow-up window, then move
            back to the queue on their own.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Last touch</TableHead>
              <TableHead className="text-right">Comes back</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow
                key={item.id}
                className="cursor-pointer"
                onClick={() => openDetail(item.id)}
              >
                <TableCell>
                  <p className="flex items-center gap-1.5 font-medium hover:text-primary hover:underline">
                    {item.name}
                    {loadingId === item.id && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                  </p>
                  {item.phone && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {item.phone}
                    </p>
                  )}
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-sm">
                  {item.campaign ?? "—"}
                </TableCell>
                <TableCell className="text-sm font-medium">
                  {item.aiScore ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {item.lastChannel ? channelLabel[item.lastChannel] ?? item.lastChannel : "—"}
                  {item.lastBy ? ` by ${item.lastBy}` : ""}
                  {" · "}
                  {formatDistanceToNow(item.lastTouchAt, { addSuffix: true })}
                </TableCell>
                <TableCell className="text-right text-sm">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDistanceToNow(item.dueAt, { addSuffix: true })}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      {/* Full lead detail as a slide-over — same sheet the queue opens. */}
      <LeadDetailSheet
        lead={detail}
        onClose={() => setDetail(null)}
        onPatch={(patch) => setDetail((d) => (d ? { ...d, ...patch } : d))}
      />
    </Card>
  );
}
