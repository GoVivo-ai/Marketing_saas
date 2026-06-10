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
import { demoLeads } from "@/lib/demo-data";

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  new: "default",
  contacted: "secondary",
  qualified: "outline",
  won: "default",
  lost: "destructive",
};

export default function LeadsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Unified Lead Inbox</h1>
        <p className="text-sm text-muted-foreground">
          One source of truth for marketing and operations — no more duplicated
          spreadsheets. Every lead is scored by AI the moment it arrives.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Incoming leads</CardTitle>
          <CardDescription>
            Synced in near real-time from Meta Lead Ads · {demoLeads.length} this week
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              {demoLeads.map((lead) => (
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
                    <div className="flex w-32 items-center gap-2">
                      <Progress value={lead.aiScore} className="h-1.5" />
                      <span className="w-7 text-sm font-medium">{lead.aiScore}</span>
                    </div>
                    <p className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground">
                      {lead.aiReason}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[lead.status]} className="capitalize">
                      {lead.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
