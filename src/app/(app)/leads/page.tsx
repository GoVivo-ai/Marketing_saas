import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getLeadRows, getWorkspaceContext } from "@/lib/data";
import { LeadsTable } from "./leads-table";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const { active } = await getWorkspaceContext();
  const rows = active ? await getLeadRows(active.id) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {active ? `${active.name} — Leads` : "Unified Lead Inbox"}
        </h1>
        <p className="text-sm text-muted-foreground">
          One source of truth for marketing and operations — no more duplicated
          spreadsheets.
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
            <LeadsTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
