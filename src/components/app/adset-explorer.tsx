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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  // Cascading location filter: state (region) first, then its cities.
  // "all" = no filter (the Select component doesn't allow empty values).
  const [region, setRegion] = useState("all");
  const [city, setCity] = useState("all");

  const counts = {
    all: adsets.length,
    active: adsets.filter((a) => a.status === "ACTIVE").length,
    paused: adsets.filter((a) => a.status !== "ACTIVE").length,
  };
  const regions = [...new Set(adsets.map((a) => a.region).filter(Boolean))].sort() as string[];
  const cities = [
    ...new Set(
      adsets
        .filter((a) => region === "all" || a.region === region)
        .map((a) => a.city)
        .filter(Boolean),
    ),
  ].sort() as string[];
  const visible = adsets.filter(
    (a) =>
      (status === "all"
        ? true
        : status === "active"
          ? a.status === "ACTIVE"
          : a.status !== "ACTIVE") &&
      (region === "all" || a.region === region) &&
      (city === "all" || a.city === city),
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

        {regions.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Select
              value={region}
              onValueChange={(v) => {
                if (!v) return;
                setRegion(v);
                setCity("all");
                setSelectedId(null);
              }}
            >
              <SelectTrigger className="h-8 w-44 text-xs" aria-label="State">
                <SelectValue placeholder="State…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                {regions.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={city}
              onValueChange={(v) => {
                if (!v) return;
                setCity(v);
                setSelectedId(null);
              }}
            >
              <SelectTrigger className="h-8 w-44 text-xs" aria-label="City">
                <SelectValue placeholder="City…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cities</SelectItem>
                {cities.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          </Table>
        </div>
      </div>
      </div>
    </div>
  );
}
