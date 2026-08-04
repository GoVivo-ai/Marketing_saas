import Link from "next/link";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  XCircle,
  CircleDot,
  AlertTriangle,
  Cable,
} from "lucide-react";
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
import { getWorkspaceContext } from "@/lib/data";
import { getDispatchSchedule } from "@/lib/dispatch-data";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** EverDriven trip status → visual tone. */
const STATUS_STYLE: Record<string, { cls: string; Icon: typeof CircleDot }> = {
  Completed: { cls: "text-success", Icon: CheckCircle2 },
  Canceled: { cls: "text-destructive", Icon: XCircle },
  Cancelled: { cls: "text-destructive", Icon: XCircle },
  "At Risk": { cls: "text-amber-500", Icon: AlertTriangle },
  Scheduled: { cls: "text-sky-500", Icon: CircleDot },
  ToStop: { cls: "text-sky-500", Icon: CircleDot },
};

export default async function DispatchSchedulePage() {
  const { active } = await getWorkspaceContext();
  if (!active) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
        <p className="text-sm text-muted-foreground">No workspace selected.</p>
      </div>
    );
  }

  const schedule = await getDispatchSchedule(active.id);
  const byStatus = new Map<string, number>();
  for (const t of schedule.trips)
    byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dispatch"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Dispatch
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CalendarClock className="h-6 w-6" />
          Today&apos;s schedule
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          EverDriven trip assignments, refreshed by the dispatch bot every 10
          minutes.
          {schedule.uploadedAt ? ` Last upload: ${schedule.uploadedAt}.` : ""}
        </p>
      </div>

      {!schedule.configured ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Cable className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Google Sheets access isn&apos;t configured yet.</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Set <code className="font-mono text-xs">GOOGLE_SERVICE_ACCOUNT_JSON</code>{" "}
              and <code className="font-mono text-xs">DISPATCH_SHEET_ID</code>, and share
              the bot&apos;s sheet with the service account as Viewer. The schedule
              lights up on the next load — no deploy needed beyond the env vars.
            </p>
          </CardContent>
        </Card>
      ) : schedule.error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <p className="font-medium">Couldn&apos;t read the schedule sheet.</p>
            <p className="max-w-lg break-all text-sm text-muted-foreground">
              {schedule.error}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {[...byStatus.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => {
                const style = STATUS_STYLE[status];
                return (
                  <Badge key={status} variant="outline" className="gap-1.5">
                    <span className={cn("font-semibold tabular-nums", style?.cls)}>
                      {count}
                    </span>
                    {status || "No status"}
                  </Badge>
                );
              })}
            {schedule.unresolved > 0 && (
              <Badge variant="outline" className="gap-1.5 border-amber-500/40">
                <AlertTriangle className="h-3 w-3 text-amber-500" />
                {schedule.unresolved} without a driver-master match
              </Badge>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Trips</CardTitle>
              <CardDescription>
                {schedule.trips.length} {schedule.trips.length === 1 ? "trip" : "trips"} on
                the board, joined to the driver master by name → MDD.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>MDD</TableHead>
                    <TableHead>Area</TableHead>
                    <TableHead>Run</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedule.trips.map((t, i) => {
                    const style = STATUS_STYLE[t.status];
                    const Icon = style?.Icon ?? CircleDot;
                    return (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {t.start || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                          {t.end || "—"}
                        </TableCell>
                        <TableCell>
                          {t.driverId ? (
                            <Link
                              href={`/dispatch/${t.driverId}`}
                              className="font-medium hover:text-primary hover:underline"
                            >
                              {t.driverName}
                            </Link>
                          ) : (
                            <span
                              className="flex items-center gap-1 font-medium"
                              title="No match in the driver master — check the spelling or add the driver"
                            >
                              {t.driverName}
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {t.driverMdd ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {t.driverArea ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-72 truncate text-xs text-muted-foreground">
                          {t.run || "—"}
                        </TableCell>
                        <TableCell>
                          <span className={cn("flex items-center gap-1.5 text-sm", style?.cls)}>
                            <Icon className="h-3.5 w-3.5" />
                            {t.status || "—"}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {schedule.trips.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        No trips on the schedule right now.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
