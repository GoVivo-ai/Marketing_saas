"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { LeadDetailSheet } from "@/components/app/lead-detail-sheet";
import type { LeadRow } from "@/lib/data";

export function LeadsTable({
  rows,
  initialLead = null,
}: {
  rows: LeadRow[];
  contactConnected?: boolean;
  /** Deep-linked lead (?lead=<id>) whose sheet opens on load. */
  initialLead?: LeadRow | null;
}) {
  const [selected, setSelected] = useState<LeadRow | null>(initialLead);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const close = () => {
    setSelected(null);
    // Drop the ?lead= deep link so refresh/back doesn't reopen the sheet.
    if (searchParams.has("lead")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("lead");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }
  };

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

      <LeadDetailSheet
        lead={selected}
        onClose={close}
        onPatch={(patch) =>
          setSelected((cur) => (cur ? { ...cur, ...patch } : cur))
        }
      />
    </>
  );
}
