"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MapPin, MapPinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdSetRow } from "@/lib/data";
import { CityRadiusMap } from "./city-radius-map";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Campaign drill-down: a map of every ad set's audience location (city +
 * targeting radius) paired with a metrics table. Selecting a city in either
 * place highlights it in the other.
 */
export function AdSetExplorer({ adsets }: { adsets: AdSetRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const locatedCount = adsets.filter((a) => a.lat != null && a.lng != null).length;

  if (adsets.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No ad sets synced for this campaign yet. Run a sync to pull them in.
      </p>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <CityRadiusMap
          adsets={adsets}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {locatedCount} of {adsets.length} ad sets placed on the map · the
          circle shows the audience radius. Click a city to focus it.
        </p>
      </div>

      <div className="lg:col-span-2">
        <div className="max-h-[420px] overflow-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>City</TableHead>
                <TableHead className="text-right">Radius</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">CPL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adsets.map((a) => {
                const located = a.lat != null && a.lng != null;
                return (
                  <TableRow
                    key={a.id}
                    onClick={() => located && setSelectedId(a.id)}
                    className={cn(
                      located && "cursor-pointer",
                      selectedId === a.id && "bg-muted",
                    )}
                  >
                    <TableCell className="max-w-[180px]">
                      <div className="flex items-center gap-1.5">
                        {/* Reserve the icon slot in every row so labels stay
                            aligned; ad sets without a located city show a faded
                            "no location" marker instead of nothing. */}
                        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                          {located ? (
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <MapPinOff
                              className="h-3.5 w-3.5 text-muted-foreground/40"
                              aria-label="No location"
                            />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {a.city ?? a.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {a.region ?? a.name}
                          </p>
                        </div>
                        {a.status !== "ACTIVE" && (
                          <Badge variant="secondary" className="ml-auto shrink-0">
                            {a.status === "PAUSED" ? "Paused" : a.status}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {a.radius != null
                        ? `${a.radius} ${a.distanceUnit === "kilometer" ? "km" : "mi"}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">{usd(a.spend)}</TableCell>
                    <TableCell className="text-right">{a.leads}</TableCell>
                    <TableCell className="text-right">
                      {a.cpl ? usd(a.cpl) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
