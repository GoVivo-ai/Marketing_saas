/**
 * EverDriven schedule ingest — the platform-native replacement of the bot's
 * Google Sheet hop. The office-PC sync script POSTs the same "all runs" CSV
 * to /upload-schedule (same multipart contract as the bot); rows accumulate
 * per trip date so the schedule keeps history instead of being replaced.
 *
 * Until the PC's UPLOAD_URL is switched over, this table simply stays empty
 * and the schedule screen keeps reading the bot's Sheet (see
 * getDispatchSchedule's freshness fallback).
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Uppercase, accent- and whitespace-normalized (mirrors the import). */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export interface CsvTripRow {
  date: string;
  start: string;
  end: string;
  driverName: string;
  status: string;
  run: string;
}

/**
 * Parses EverDriven's "all runs" CSV export. Expected columns: Status,
 * Driver Name, Date, Start (End and SR Name/Run optional) — same contract
 * as the bot's parse_csv_upload; extra columns are ignored.
 */
export function parseScheduleCsv(text: string): CsvTripRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines.length < 2) return [];
  // Minimal CSV parsing with quoted-field support.
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };

  const header = split(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = {
    date: col("date"),
    start: col("start"),
    end: col("end"),
    driver: col("driver name"),
    status: col("status"),
    run: col("sr name", "run"),
  };
  if (c.date < 0 || c.start < 0 || c.driver < 0) return [];

  const rows: CsvTripRow[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = split(line);
    const driverName = (f[c.driver] ?? "").trim();
    const dateStr = (f[c.date] ?? "").trim();
    const start = (f[c.start] ?? "").trim();
    if (!driverName || !dateStr || !start) continue;
    rows.push({
      date: dateStr,
      start,
      end: c.end >= 0 ? (f[c.end] ?? "").trim() : "",
      driverName,
      status: c.status >= 0 ? (f[c.status] ?? "").trim() : "",
      run: c.run >= 0 ? (f[c.run] ?? "").trim() : "",
    });
  }
  return rows;
}

/** EverDriven dates come as "8/4 Tue" (no year) — anchor to the nearest year. */
export function parseTripDate(raw: string, now = new Date()): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // A December upload mentioning January belongs to next year (and vice
  // versa) — pick the candidate closest to today.
  const year = now.getFullYear();
  const candidates = [year - 1, year, year + 1].map(
    (y) => new Date(Date.UTC(y, month - 1, day)),
  );
  const best = candidates.reduce((a, b) =>
    Math.abs(a.getTime() - now.getTime()) < Math.abs(b.getTime() - now.getTime())
      ? a
      : b,
  );
  return best.toISOString().slice(0, 10);
}

export interface ScheduleIngestResult {
  parsed: number;
  upserted: number;
  skipped: number;
}

/**
 * Name → driver id resolver: exact normalized match, then "Last, First"
 * flipped, then best token overlap (≥2 shared tokens, unique winner) —
 * EverDriven types names by hand.
 */
export function buildDriverResolver(
  drivers: { id: string; normName: string }[],
): (name: string) => string | null {
  const byName = new Map(drivers.map((d) => [d.normName, d.id]));
  return (name: string) => {
    const norm = normalizeName(name);
    const exact = byName.get(norm);
    if (exact) return exact;
    if (norm.includes(",")) {
      const [last, first] = norm.split(",").map((s) => s.trim());
      const flipped = byName.get(`${first} ${last}`);
      if (flipped) return flipped;
    }
    const tokens = new Set(norm.replace(/,/g, "").split(" "));
    let best: string | null = null;
    let bestScore = 1;
    let tied = false;
    for (const d of drivers) {
      let score = 0;
      for (const t of d.normName.split(" ")) if (tokens.has(t)) score++;
      if (score > bestScore) {
        best = d.id;
        bestScore = score;
        tied = false;
      } else if (score === bestScore && best) tied = true;
    }
    return tied ? null : best;
  };
}

/** Upserts the CSV's trips (status refreshes in place on re-upload). */
export async function ingestScheduleCsv(
  workspaceId: string,
  csvText: string,
): Promise<ScheduleIngestResult> {
  const rows = parseScheduleCsv(csvText);
  const drivers = await db()
    .select({
      id: schema.dispatchDrivers.id,
      normName: schema.dispatchDrivers.normName,
    })
    .from(schema.dispatchDrivers)
    .where(eq(schema.dispatchDrivers.workspaceId, workspaceId));
  const resolve = buildDriverResolver(drivers);

  const uploadedAt = new Date();
  let upserted = 0;
  let skipped = 0;
  for (const r of rows) {
    const tripDate = parseTripDate(r.date);
    if (!tripDate) {
      skipped++;
      continue;
    }
    const normName = normalizeName(r.driverName);
    const driverId = resolve(r.driverName);
    await db()
      .insert(schema.dispatchScheduleTrips)
      .values({
        workspaceId,
        tripDate,
        start: r.start,
        end: r.end || null,
        driverName: r.driverName,
        normName,
        driverId,
        status: r.status || null,
        run: r.run || null,
        uploadedAt,
      })
      .onConflictDoUpdate({
        target: [
          schema.dispatchScheduleTrips.workspaceId,
          schema.dispatchScheduleTrips.tripDate,
          schema.dispatchScheduleTrips.run,
          schema.dispatchScheduleTrips.normName,
          schema.dispatchScheduleTrips.start,
        ],
        set: {
          end: r.end || null,
          status: r.status || null,
          driverId,
          uploadedAt,
        },
      });
    upserted++;
  }
  return { parsed: rows.length, upserted, skipped };
}

/**
 * The freshest ingested upload for a given date, or null when the direct
 * ingest isn't live yet (PC still pointing at the bot).
 */
export async function latestIngestAt(
  workspaceId: string,
  tripDate: string,
): Promise<Date | null> {
  const [row] = await db()
    .select({ at: sql<Date | null>`max(${schema.dispatchScheduleTrips.uploadedAt})` })
    .from(schema.dispatchScheduleTrips)
    .where(
      and(
        eq(schema.dispatchScheduleTrips.workspaceId, workspaceId),
        eq(schema.dispatchScheduleTrips.tripDate, tripDate),
      ),
    );
  return row?.at ? new Date(row.at) : null;
}

export interface IngestedTrip {
  tripDate: string;
  start: string;
  end: string | null;
  driverName: string;
  driverId: string | null;
  status: string | null;
  run: string | null;
  uploadedAt: Date;
}

/** All ingested trips for one date, earliest start first. */
export async function tripsForDate(
  workspaceId: string,
  tripDate: string,
): Promise<IngestedTrip[]> {
  return db()
    .select({
      tripDate: schema.dispatchScheduleTrips.tripDate,
      start: schema.dispatchScheduleTrips.start,
      end: schema.dispatchScheduleTrips.end,
      driverName: schema.dispatchScheduleTrips.driverName,
      driverId: schema.dispatchScheduleTrips.driverId,
      status: schema.dispatchScheduleTrips.status,
      run: schema.dispatchScheduleTrips.run,
      uploadedAt: schema.dispatchScheduleTrips.uploadedAt,
    })
    .from(schema.dispatchScheduleTrips)
    .where(
      and(
        eq(schema.dispatchScheduleTrips.workspaceId, workspaceId),
        eq(schema.dispatchScheduleTrips.tripDate, tripDate),
        gte(schema.dispatchScheduleTrips.uploadedAt, sql`now() - interval '2 days'`),
      ),
    )
    .orderBy(schema.dispatchScheduleTrips.start);
}
