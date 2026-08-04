import Link from "next/link";
import { MapPin, Video, Armchair, ShieldAlert } from "lucide-react";
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
import { LeadsSearch } from "@/components/app/leads-search";
import { LeadsFilter } from "@/components/app/leads-filter";
import { format } from "date-fns";
import { getWorkspaceContext } from "@/lib/data";
import { getDispatchDirectory } from "@/lib/dispatch-data";

export const dynamic = "force-dynamic";

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; area?: string; status?: string }>;
}) {
  const { active } = await getWorkspaceContext();
  if (!active) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Dispatch</h1>
        <p className="text-sm text-muted-foreground">No workspace selected.</p>
      </div>
    );
  }

  const sp = await searchParams;
  const q = sp.q?.trim() || null;
  const { drivers, total, areas } = await getDispatchDirectory(active.id, {
    q,
    area: sp.area ?? null,
    status: sp.status ?? null,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {active.name} — Dispatch
          </h1>
          <p className="text-sm text-muted-foreground">
            The driver master — one record per driver, everything connected by
            their MDD.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LeadsFilter
            param="status"
            icon="stage"
            title="Status"
            allLabel="All statuses"
            activeValue={sp.status ?? null}
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
          />
          <LeadsFilter
            param="area"
            icon="city"
            title="Area"
            allLabel="All areas"
            activeValue={sp.area ?? null}
            options={areas.map((a) => ({ value: a, label: a }))}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Drivers</CardTitle>
              <CardDescription>
                {total} {total === 1 ? "driver" : "drivers"}
                {q ? ` matching “${q}”` : ""}
              </CardDescription>
            </div>
            <div className="w-full sm:w-72">
              <LeadsSearch initialValue={q ?? ""} />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Driver</TableHead>
                <TableHead>MDD</TableHead>
                <TableHead>Area</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Equipment</TableHead>
                <TableHead className="text-right">Covers</TableHead>
                <TableHead className="text-right">Interactions</TableHead>
                <TableHead>Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drivers.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link
                      href={`/dispatch/${d.id}`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {d.name}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Badge
                        variant={d.status === "active" ? "default" : "secondary"}
                        className="h-4 px-1.5 text-[10px] capitalize"
                      >
                        {d.status}
                      </Badge>
                      {d.status === "active" && !d.hasRoutes && (
                        <span className="text-[10px] text-muted-foreground">
                          no routes
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {d.mdd ?? "—"}
                  </TableCell>
                  <TableCell>
                    {d.area ? (
                      <span className="flex items-center gap-1 text-sm">
                        <MapPin className="h-3 w-3 text-muted-foreground" />
                        {d.area}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div>{d.phone ?? "—"}</div>
                    <div className="max-w-44 truncate">{d.email ?? ""}</div>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {d.camera && (
                        <span className="flex items-center gap-0.5" title="Camera installed">
                          <Video className="h-3.5 w-3.5" />
                        </span>
                      )}
                      {d.carSeats > 0 && (
                        <span className="flex items-center gap-0.5" title="Car seats">
                          <Armchair className="h-3.5 w-3.5" />
                          {d.carSeats}
                        </span>
                      )}
                      {d.boosterSeats > 0 && (
                        <span title="Booster seats">B×{d.boosterSeats}</span>
                      )}
                      {!d.camera && d.carSeats === 0 && d.boosterSeats === 0 && "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {d.coverCount || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {d.interactionCount > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <ShieldAlert className="h-3 w-3 text-muted-foreground" />
                        {d.interactionCount}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {d.lastInteractionAt
                      ? format(d.lastInteractionAt, "MMM d, yyyy")
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {drivers.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No drivers match.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
