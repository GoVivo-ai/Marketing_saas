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
import { Button } from "@/components/ui/button";
import { MultiFilter } from "@/components/app/multi-filter";
import { MapPin, MapPinOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdSetRow } from "@/lib/data";
import { isDelivering } from "@/lib/delivery";
import { DeliveryBadge } from "./delivery-badge";
import { CityRadiusMap } from "./city-radius-map";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

type StatusFilter = "all" | "delivering" | "off";

/**
 * Campaign drill-down: a map of every ad set's audience location (city +
 * targeting radius) paired with a metrics table, one row per ad set. Ad sets
 * are the unit the team buys in — an ad set can cover several small towns
 * (El Centro + Calexico), so its name, not one city, names the row.
 * Selecting a row in either panel highlights it in the other; the filter
 * narrows both to what's delivering or what's off.
 */
export function AdSetExplorer({
  adsets,
  toolbar,
}: {
  adsets: AdSetRow[];
  /** Extra filter controls (e.g. the date-range picker) shown in the filter row. */
  toolbar?: React.ReactNode;
}) {
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
  // Buckets follow DELIVERY, not the on/off switch: an ad set that's switched
  // on under a paused campaign isn't delivering, and the team reads it as off.
  const counts = {
    all: inLocation.length,
    delivering: inLocation.filter((a) => isDelivering(a.delivery)).length,
    off: inLocation.filter((a) => !isDelivering(a.delivery)).length,
  };
  const visible = inLocation.filter((a) =>
    status === "all" ? true : isDelivering(a.delivery) === (status === "delivering"),
  );

  // One row per AD SET, sorted by spend. Ad sets used to be collapsed per
  // city, which hid the ones covering several towns under a single city name
  // — the row now carries the ad set's own name and the city rides along as
  // context.
  const adsetRows = [...visible].sort((x, y) => y.spend - x.spend);
  const locatedCount = adsetRows.filter((a) => a.lat != null && a.lng != null).length;

  if (adsets.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No ad sets synced for this campaign yet. Run a sync to pull them in.
      </p>
    );
  }

  const filters: { value: StatusFilter; label: string }[] = [
    { value: "all", label: `All (${counts.all})` },
    { value: "delivering", label: `Delivering (${counts.delivering})` },
    { value: "off", label: `Off (${counts.off})` },
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

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {regionOptions.length > 0 && (
            <>
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
            </>
          )}
          {toolbar}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <CityRadiusMap
            adsets={adsetRows}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {locatedCount} of {adsetRows.length} ad sets placed on the map · the
            circle shows the audience radius. Click one to focus it.
          </p>
        </div>

      <div className="lg:col-span-2">
        <div className="overflow-hidden rounded-xl border [&_[data-slot=table-container]]:max-h-[420px]">
          <Table>
            {/* Header and totals stay pinned while the rows scroll. */}
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted [&_th]:font-semibold">
              <TableRow>
                <TableHead>Ad set</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">CPL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adsetRows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    {status === "all"
                      ? "No ad sets match these filters."
                      : `No ad sets are ${status}.`}
                  </TableCell>
                </TableRow>
              )}
              {adsetRows.map((a) => {
                const located = a.lat != null && a.lng != null;
                const radius =
                  a.radius != null
                    ? `${a.radius} ${a.distanceUnit === "kilometer" ? "km" : "mi"}`
                    : null;
                return (
                  <TableRow
                    key={a.id}
                    onClick={() => located && setSelectedId(a.id)}
                    className={cn(
                      located && "cursor-pointer",
                      selectedId === a.id && "bg-muted",
                    )}
                  >
                    <TableCell className="max-w-[200px]">
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
                          <p className="truncate font-medium" title={a.name}>
                            {a.name}
                          </p>
                          {/* The city and radius the ad set targets — dropped
                              from their own columns, kept here as context. */}
                          <p className="truncate text-xs text-muted-foreground">
                            {[a.city, a.region].filter(Boolean).join(", ") ||
                              "No city targeted"}
                            {radius ? ` · ${radius}` : ""}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <DeliveryBadge delivery={a.delivery} />
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
            {adsetRows.length > 0 && (
              /* Ads Manager-style totals for the current slice: summed spend
                 and leads, CPL recomputed from the totals (not averaged). */
              <TableFooter className="[&_td]:sticky [&_td]:bottom-0 [&_td]:z-10 [&_td]:bg-muted">
                <TableRow>
                  <TableCell className="font-medium">
                    Totals · {adsetRows.length} ad set
                    {adsetRows.length === 1 ? "" : "s"}
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
