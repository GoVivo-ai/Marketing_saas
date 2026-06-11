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
import { MapPin } from "lucide-react";
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
        Esta campaña aún no tiene conjuntos de anuncios sincronizados. Corre el
        sync para traerlos.
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
          {locatedCount} de {adsets.length} conjuntos ubicados en el mapa · el
          círculo muestra el radio de la audiencia. Haz clic en una ciudad para
          enfocarla.
        </p>
      </div>

      <div className="lg:col-span-2">
        <div className="max-h-[420px] overflow-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ciudad</TableHead>
                <TableHead className="text-right">Radio</TableHead>
                <TableHead className="text-right">Gasto</TableHead>
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
                        {located && (
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
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
                            {a.status === "PAUSED" ? "Pausado" : a.status}
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
