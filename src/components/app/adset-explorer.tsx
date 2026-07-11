"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MultiFilter } from "@/components/app/multi-filter";
import { MapPin, MapPinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdSetRow } from "@/lib/data";
import { CityRadiusMap } from "./city-radius-map";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

type StatusFilter = "all" | "active" | "paused";

/**
 * Campaign drill-down: a map of every ad set's audience location (city +
 * targeting radius) paired with a metrics table. Selecting a city in either
 * place highlights it in the other. A status filter narrows both panels to
 * active or paused ad sets.
 */
export function AdSetExplorer({ adsets }: { adsets: AdSetRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  // Cascading location filter: states (regions) first, then their cities.
  // Both are multi-select; an empty selection means "all".
  const [regions, setRegions] = useState<string[]>([]);
  const [cityFilter, setCityFilter] = useState<string[]>([]);

  const regionOptions = [
    ...new Set(adsets.map((a) => a.region).filter(Boolean)),
  ].sort() as string[];
  const cityOptions = [
    ...new Set(
      adsets
        .filter((a) => regions.length === 0 || (a.region && regions.includes(a.region)))
        .map((a) => a.city)
        .filter(Boolean),
    ),
  ].sort() as string[];
  // Status counts reflect the current state/city slice, so the All/Active/
  // Paused pills always describe what's actually being filtered.
  const inLocation = adsets.filter(
    (a) =>
      (regions.length === 0 || (a.region != null && regions.includes(a.region))) &&
      (cityFilter.length === 0 || (a.city != null && cityFilter.includes(a.city))),
  );
  const counts = {
    all: inLocation.length,
    active: inLocation.filter((a) => a.status === "ACTIVE").length,
    paused: inLocation.filter((a) => a.status !== "ACTIVE").length,
  };
  const visible = inLocation.filter((a) =>
    status === "all"
      ? true
      : status === "active"
        ? a.status === "ACTIVE"
        : a.status !== "ACTIVE",
  );
  const locatedCount = visible.filter((a) => a.lat != null && a.lng != null).length;

  if (adsets.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No ad sets synced for this campaign yet. Run a sync to pull them in.
      </p>
    );
  }

  const filters: { value: StatusFilter; label: string }[] = [
    { value: "all", label: `All (${counts.all})` },
    { value: "active", label: `Active (${counts.active})` },
    { value: "paused", label: `Paused (${counts.paused})` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {filters.map((f) => (
          <Button
            key={f.value}
            variant={status === f.value ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setStatus(f.value);
              setSelectedId(null);
            }}
          >
            {f.label}
          </Button>
        ))}

        {regionOptions.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <MultiFilter
              title="State"
              icon="state"
              allLabel="All states"
              options={regionOptions.map((r) => ({ value: r, label: r }))}
              selected={regions}
              onChange={(next) => {
                setRegions(next);
                // Drop selected cities that are no longer inside the states.
                setCityFilter((cur) =>
                  next.length === 0
                    ? cur
                    : cur.filter((c) =>
                        adsets.some(
                          (a) =>
                            a.city === c &&
                            a.region != null &&
                            next.includes(a.region),
                        ),
                      ),
                );
                setSelectedId(null);
              }}
            />
            <MultiFilter
              title="City"
              icon="city"
              allLabel="All cities"
              options={cityOptions.map((c) => ({ value: c, label: c }))}
              selected={cityFilter}
              onChange={(next) => {
                setCityFilter(next);
                setSelectedId(null);
              }}
            />
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <CityRadiusMap
            adsets={visible}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {locatedCount} of {visible.length} ad sets placed on the map · the
            circle shows the audience radius. Click a city to focus it.
          </p>
        </div>

      <div className="lg:col-span-2">
        <div className="max-h-[420px] overflow-auto rounded-xl border">
          <Table>
            {/* Header and totals stay pinned while the rows scroll. */}
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
              <TableRow>
                <TableHead>City</TableHead>
                <TableHead className="text-right">Radius</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">CPL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    No {status} ad sets.
                  </TableCell>
                </TableRow>
              )}
              {visible.map((a) => {
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
            {visible.length > 0 && (
              /* Ads Manager-style totals for the current slice: summed spend
                 and leads, CPL recomputed from the totals (not averaged). */
              <TableFooter className="[&_td]:sticky [&_td]:bottom-0 [&_td]:z-10 [&_td]:bg-card">
                <TableRow>
                  <TableCell className="font-medium">
                    Totals · {visible.length} ad set{visible.length === 1 ? "" : "s"}
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right font-medium">
                    {usd(visible.reduce((s, a) => s + a.spend, 0))}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {visible.reduce((s, a) => s + a.leads, 0)}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {(() => {
                      const spend = visible.reduce((s, a) => s + a.spend, 0);
                      const leads = visible.reduce((s, a) => s + a.leads, 0);
                      return leads > 0 ? usd(spend / leads) : "—";
                    })()}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      </div>
      </div>
    </div>
  );
}
