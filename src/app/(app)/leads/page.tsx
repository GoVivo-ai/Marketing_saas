import { formatDistanceToNow } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getDemoLeadRows, getLeadRows, getWorkspaceContext } from "@/lib/data";

export const dynamic = "force-dynamic";

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  new: "default",
  contacted: "secondary",
  qualified: "outline",
  won: "default",
  lost: "destructive",
};

export default async function LeadsPage() {
  const { active, live } = await getWorkspaceContext();
  const rows = live && active ? await getLeadRows(active.id) : getDemoLeadRows();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {active ? `${active.name} — Leads` : "Unified Lead Inbox"}
        </h1>
        <p className="text-sm text-muted-foreground">
          One source of truth for marketing and operations — no more duplicated
          spreadsheets.{live ? "" : " · Demo data"}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Incoming leads</CardTitle>
          <CardDescription>
            Synced from Meta Lead Ads · {rows.length} total
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No leads synced yet. They will appear here after the first sync of
              a connected account.
            </p>
          ) : (
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
                  <TableRow key={lead.id}>
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
