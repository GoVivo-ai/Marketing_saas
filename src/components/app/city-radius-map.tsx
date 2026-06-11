"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { AdSetRow } from "@/lib/data";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Convert a targeting radius to meters (Leaflet circles use meters). */
function radiusMeters(radius: number | null, unit: string | null): number | null {
  if (radius == null) return null;
  return unit === "kilometer" ? radius * 1000 : radius * 1609.34; // default: miles
}

interface Props {
  adsets: AdSetRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Plots each ad set's audience location as a circle (its targeting radius)
 * on an OpenStreetMap base — no API key. Leaflet touches `window`, so it's
 * imported lazily inside an effect to stay out of the server render.
 */
export function CityRadiusMap({ adsets, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep handles so the selection effect can fly to / highlight a city.
  const layersRef = useRef<Record<string, { circle: unknown; lat: number; lng: number }>>({});
  const mapRef = useRef<unknown>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const located = adsets.filter((a) => a.lat != null && a.lng != null);

  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | null = null;

    (async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      map = L.map(containerRef.current, { scrollWheelZoom: false });
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      const layers: Record<string, { circle: unknown; lat: number; lng: number }> = {};
      const bounds: [number, number][] = [];

      for (const a of located) {
        const lat = a.lat as number;
        const lng = a.lng as number;
        const meters = radiusMeters(a.radius, a.distanceUnit);
        const active = a.status === "ACTIVE";
        const color = active ? "#04d98b" : "#94a3b8";

        const circle = meters
          ? L.circle([lat, lng], {
              radius: meters,
              color,
              weight: 2,
              fillColor: color,
              fillOpacity: 0.18,
            })
          : L.circleMarker([lat, lng], {
              radius: 7,
              color,
              weight: 2,
              fillColor: color,
              fillOpacity: 0.4,
            });

        const radiusLabel =
          a.radius != null
            ? `${a.radius} ${a.distanceUnit === "kilometer" ? "km" : "mi"}`
            : "sin radio";
        circle.bindPopup(
          `<strong>${a.city ?? a.name}</strong><br/>` +
            `${a.region ?? ""}<br/>` +
            `Radio: ${radiusLabel}<br/>` +
            `Gasto: ${usd(a.spend)} · Leads: ${a.leads}`,
        );
        circle.on("click", () => onSelectRef.current(a.id));
        circle.addTo(map);
        layers[a.id] = { circle, lat, lng };
        bounds.push([lat, lng]);
      }

      layersRef.current = layers;
      if (bounds.length === 1) map.setView(bounds[0], 9);
      else if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40] });
      else map.setView([39.5, -98.35], 4); // continental US fallback
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
      mapRef.current = null;
      layersRef.current = {};
    };
    // Rebuild only when the set of located ad sets changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [located.map((a) => a.id).join(",")]);

  // Fly to and open the popup of the selected city.
  useEffect(() => {
    const map = mapRef.current as import("leaflet").Map | null;
    const entry = selectedId ? layersRef.current[selectedId] : null;
    if (!map || !entry) return;
    map.flyTo([entry.lat, entry.lng], Math.max(map.getZoom(), 10), {
      duration: 0.6,
    });
    (entry.circle as import("leaflet").Layer).openPopup?.();
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      className="h-[420px] w-full overflow-hidden rounded-xl border bg-muted"
      // Leaflet panes must sit below app overlays (dropdowns, toasts).
      style={{ zIndex: 0 }}
    />
  );
}
