/**
 * Dispatch module data layer — the driver master, ride covers and compliance
 * interactions that replace the ops team's loose spreadsheets. Everything is
 * keyed by the driver's MDD (EverDriven id); rows imported from the old files
 * keep the raw names so nothing is lost when a name didn't resolve.
 */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";
import { isSheetsConfigured, readSheetRange } from "@/lib/integrations/google-sheets";
import { latestIngestAt, tripsForDate } from "@/lib/dispatch-schedule";

export interface DispatchDriverRow {
  id: string;
  mdd: string | null;
  name: string;
  state: string | null;
  area: string | null;
  status: string;
  hasRoutes: boolean;
  phone: string | null;
  email: string | null;
  camera: boolean;
  carSeats: number;
  boosterSeats: number;
  /** Activity rolled up from covers + interactions. */
  coverCount: number;
  interactionCount: number;
  lastInteractionAt: Date | null;
}

export interface DispatchDirectory {
  drivers: DispatchDriverRow[];
  total: number;
  page: number;
  totalPages: number;
  areas: string[];
}

export const DISPATCH_PAGE_SIZE = 25;

/** Driver directory with search + filters and per-driver activity counts. */
export async function getDispatchDirectory(
  workspaceId: string,
  opts: {
    q?: string | null;
    area?: string | null;
    status?: string | null;
    page?: number;
  } = {},
): Promise<DispatchDirectory> {
  const filters = [
    eq(schema.dispatchDrivers.workspaceId, workspaceId),
    opts.q
      ? or(
          ilike(schema.dispatchDrivers.name, `%${opts.q}%`),
          ilike(schema.dispatchDrivers.mdd, `%${opts.q}%`),
          ilike(schema.dispatchDrivers.phone, `%${opts.q}%`),
          ilike(schema.dispatchDrivers.email, `%${opts.q}%`),
        )
      : undefined,
    opts.area ? eq(schema.dispatchDrivers.area, opts.area) : undefined,
    opts.status ? eq(schema.dispatchDrivers.status, opts.status) : undefined,
  ];

  const [[{ total }], drivers, areaRows] = await Promise.all([
    db()
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.dispatchDrivers)
      .where(and(...filters)),
    db()
      .select({
        id: schema.dispatchDrivers.id,
        mdd: schema.dispatchDrivers.mdd,
        name: schema.dispatchDrivers.name,
        state: schema.dispatchDrivers.state,
        area: schema.dispatchDrivers.area,
        status: schema.dispatchDrivers.status,
        hasRoutes: schema.dispatchDrivers.hasRoutes,
        phone: schema.dispatchDrivers.phone,
        email: schema.dispatchDrivers.email,
        camera: schema.dispatchDrivers.camera,
        carSeats: schema.dispatchDrivers.carSeats,
        boosterSeats: schema.dispatchDrivers.boosterSeats,
        // NB: the outer column must be spelled table-qualified by hand —
        // drizzle renders interpolated columns unqualified inside raw SQL,
        // and the subquery would silently resolve them against its own table.
        coverCount: sql<number>`(
          select count(*)::int from ${schema.dispatchCovers} c
          where c.driver_id = "dispatch_drivers"."id"
             or c.rescue_driver_id = "dispatch_drivers"."id"
        )`,
        interactionCount: sql<number>`(
          select count(*)::int from ${schema.dispatchInteractions} i
          where i.driver_id = "dispatch_drivers"."id"
        )`,
        lastInteractionAt: sql<Date | null>`(
          select max(i.sp_created_at) from ${schema.dispatchInteractions} i
          where i.driver_id = "dispatch_drivers"."id"
        )`,
      })
      .from(schema.dispatchDrivers)
      .where(and(...filters))
      .orderBy(schema.dispatchDrivers.name)
      .limit(DISPATCH_PAGE_SIZE)
      .offset((Math.max(1, opts.page ?? 1) - 1) * DISPATCH_PAGE_SIZE),
    db()
      .selectDistinct({ area: schema.dispatchDrivers.area })
      .from(schema.dispatchDrivers)
      .where(eq(schema.dispatchDrivers.workspaceId, workspaceId)),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / DISPATCH_PAGE_SIZE));
  const page = Math.min(Math.max(1, opts.page ?? 1), totalPages);
  // Out-of-range ?page= (stale link, shrunk filter) → serve the last page
  // instead of an empty table.
  if (drivers.length === 0 && total > 0 && page !== opts.page) {
    return getDispatchDirectory(workspaceId, { ...opts, page });
  }
  return {
    drivers,
    total,
    page,
    totalPages,
    areas: areaRows
      .map((r) => r.area)
      .filter((a): a is string => Boolean(a))
      .sort(),
  };
}

export interface DriverCoverRow {
  id: string;
  date: Date | null;
  rescueDate: Date | null;
  area: string | null;
  reason: string | null;
  payment: string | null;
  comments: string | null;
  /** Which side of the cover this driver is on. */
  role: "absent" | "rescue";
  /** The other driver in the cover (rescuer when absent, absentee when rescuing). */
  counterpartName: string | null;
  counterpartId: string | null;
}

export interface DriverInteractionRow {
  id: string;
  priority: string | null;
  status: string | null;
  description: string | null;
  category: string | null;
  subCategories: string[] | null;
  assignedTo: string | null;
  createdBy: string | null;
  spCreatedAt: Date | null;
  resolvedAt: Date | null;
}

export interface Driver360 {
  driver: {
    id: string;
    mdd: string | null;
    name: string;
    state: string | null;
    area: string | null;
    address: string | null;
    status: string;
    hasRoutes: boolean;
    phone: string | null;
    email: string | null;
    emergencyName: string | null;
    emergencyPhone: string | null;
    emergencyRelation: string | null;
    camera: boolean;
    carSeats: number;
    boosterSeats: number;
  };
  covers: DriverCoverRow[];
  interactions: DriverInteractionRow[];
}

/** Everything about one driver: profile + covers (both roles) + compliance. */
export async function getDriver360(
  workspaceId: string,
  driverId: string,
): Promise<Driver360 | null> {
  const [driver] = await db()
    .select()
    .from(schema.dispatchDrivers)
    .where(
      and(
        eq(schema.dispatchDrivers.id, driverId),
        eq(schema.dispatchDrivers.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!driver) return null;

  const other = alias(schema.dispatchDrivers, "other_driver");

  const [asAbsent, asRescue, interactions] = await Promise.all([
    db()
      .select({
        id: schema.dispatchCovers.id,
        date: schema.dispatchCovers.date,
        rescueDate: schema.dispatchCovers.rescueDate,
        area: schema.dispatchCovers.area,
        reason: schema.dispatchCovers.reason,
        payment: schema.dispatchCovers.payment,
        comments: schema.dispatchCovers.comments,
        counterpartName: sql<string | null>`coalesce(${other.name}, ${schema.dispatchCovers.rescueName})`,
        counterpartId: schema.dispatchCovers.rescueDriverId,
      })
      .from(schema.dispatchCovers)
      .leftJoin(other, eq(other.id, schema.dispatchCovers.rescueDriverId))
      .where(eq(schema.dispatchCovers.driverId, driverId))
      .orderBy(desc(schema.dispatchCovers.date)),
    db()
      .select({
        id: schema.dispatchCovers.id,
        date: schema.dispatchCovers.date,
        rescueDate: schema.dispatchCovers.rescueDate,
        area: schema.dispatchCovers.area,
        reason: schema.dispatchCovers.reason,
        payment: schema.dispatchCovers.payment,
        comments: schema.dispatchCovers.comments,
        counterpartName: sql<string | null>`coalesce(${other.name}, ${schema.dispatchCovers.driverName})`,
        counterpartId: schema.dispatchCovers.driverId,
      })
      .from(schema.dispatchCovers)
      .leftJoin(other, eq(other.id, schema.dispatchCovers.driverId))
      .where(eq(schema.dispatchCovers.rescueDriverId, driverId))
      .orderBy(desc(schema.dispatchCovers.date)),
    db()
      .select({
        id: schema.dispatchInteractions.id,
        priority: schema.dispatchInteractions.priority,
        status: schema.dispatchInteractions.status,
        description: schema.dispatchInteractions.description,
        category: schema.dispatchInteractions.category,
        subCategories: schema.dispatchInteractions.subCategories,
        assignedTo: schema.dispatchInteractions.assignedTo,
        createdBy: schema.dispatchInteractions.createdBy,
        spCreatedAt: schema.dispatchInteractions.spCreatedAt,
        resolvedAt: schema.dispatchInteractions.resolvedAt,
      })
      .from(schema.dispatchInteractions)
      .where(eq(schema.dispatchInteractions.driverId, driverId))
      .orderBy(desc(schema.dispatchInteractions.spCreatedAt)),
  ]);

  const covers: DriverCoverRow[] = [
    ...asAbsent.map((c) => ({ ...c, role: "absent" as const })),
    ...asRescue.map((c) => ({ ...c, role: "rescue" as const })),
  ].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  return {
    driver,
    covers,
    interactions: interactions.map((i) => ({
      ...i,
      subCategories: Array.isArray(i.subCategories)
        ? (i.subCategories as string[])
        : null,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Today's schedule — read live from the dispatch bot's Google Sheet (the bot
// downloads EverDriven's "all runs" CSV every 10 minutes and replaces the
// Schedule tab). EverDriven identifies drivers by name only, so each row is
// resolved against the driver master by normalized name.
// ─────────────────────────────────────────────────────────────────────────

export interface ScheduleTrip {
  date: string;
  start: string;
  end: string;
  driverName: string;
  /** Resolved driver (null when the name didn't match the master). */
  driverId: string | null;
  driverMdd: string | null;
  driverArea: string | null;
  status: string;
  run: string;
  uploadedAt: string;
}

export interface DispatchSchedule {
  configured: boolean;
  trips: ScheduleTrip[];
  /** When the bot last replaced the tab (from the Uploaded At column). */
  uploadedAt: string | null;
  /** Count of rows whose driver name didn't resolve to the master. */
  unresolved: number;
  /** Where this board came from: the direct CSV ingest or the bot's Sheet. */
  source: "direct" | "sheet";
  error?: string;
}

/** Uppercase, accent- and whitespace-normalized — mirrors the import script. */
function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export async function getDispatchSchedule(
  workspaceId: string,
): Promise<DispatchSchedule> {
  // Direct CSV ingest wins when it's fresh — once the office PC's sync
  // points at /upload-schedule, the Sheet hop drops out on its own. The
  // sync uploads every 10 minutes, so ≤30 min counts as live.
  const ptToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());
  const ingestAt = await latestIngestAt(workspaceId, ptToday);
  if (ingestAt && Date.now() - ingestAt.getTime() < 30 * 60_000) {
    const [rows, masters] = await Promise.all([
      tripsForDate(workspaceId, ptToday),
      db()
        .select({
          id: schema.dispatchDrivers.id,
          mdd: schema.dispatchDrivers.mdd,
          area: schema.dispatchDrivers.area,
        })
        .from(schema.dispatchDrivers)
        .where(eq(schema.dispatchDrivers.workspaceId, workspaceId)),
    ]);
    const byId = new Map(masters.map((d) => [d.id, d]));
    return {
      configured: true,
      source: "direct",
      trips: rows.map((t) => ({
        date: t.tripDate,
        start: t.start,
        end: t.end ?? "",
        driverName: t.driverName,
        driverId: t.driverId,
        driverMdd: t.driverId ? (byId.get(t.driverId)?.mdd ?? null) : null,
        driverArea: t.driverId ? (byId.get(t.driverId)?.area ?? null) : null,
        status: t.status ?? "",
        run: t.run ?? "",
        uploadedAt: t.uploadedAt.toISOString(),
      })),
      uploadedAt: ingestAt.toISOString(),
      unresolved: rows.filter((t) => !t.driverId).length,
    };
  }

  if (!isSheetsConfigured())
    return {
      configured: false,
      trips: [],
      uploadedAt: null,
      unresolved: 0,
      source: "sheet",
    };

  let rows: string[][];
  try {
    rows = await readSheetRange("Schedule");
  } catch (err) {
    return {
      configured: true,
      trips: [],
      uploadedAt: null,
      unresolved: 0,
      source: "sheet",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (rows.length < 2)
    return {
      configured: true,
      trips: [],
      uploadedAt: null,
      unresolved: 0,
      source: "sheet",
    };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const c = {
    date: col("date"),
    start: col("start"),
    end: col("end"),
    driver: col("driver name"),
    status: col("status"),
    uploaded: col("uploaded at"),
    run: col("run"),
  };

  const drivers = await db()
    .select({
      id: schema.dispatchDrivers.id,
      mdd: schema.dispatchDrivers.mdd,
      area: schema.dispatchDrivers.area,
      normName: schema.dispatchDrivers.normName,
    })
    .from(schema.dispatchDrivers)
    .where(eq(schema.dispatchDrivers.workspaceId, workspaceId));
  const byName = new Map(drivers.map((d) => [d.normName, d]));

  // Exact normalized match first; else the driver sharing the most name
  // tokens (≥2, unique winner) — EverDriven types names by hand, so
  // "Katerine"/"Katerina" style drift is routine.
  const resolve = (name: string) => {
    const norm = normalizeName(name);
    const exact = byName.get(norm);
    if (exact) return exact;
    const tokens = new Set(norm.split(" "));
    let best: (typeof drivers)[number] | null = null;
    let bestScore = 1;
    let tied = false;
    for (const d of drivers) {
      let score = 0;
      for (const t of d.normName.split(" ")) if (tokens.has(t)) score++;
      if (score > bestScore) {
        best = d;
        bestScore = score;
        tied = false;
      } else if (score === bestScore && best) tied = true;
    }
    return tied ? null : best;
  };

  const trips: ScheduleTrip[] = [];
  let unresolved = 0;
  for (const r of rows.slice(1)) {
    const name = (r[c.driver] ?? "").trim();
    if (!name) continue;
    const match = resolve(name);
    if (!match) unresolved++;
    trips.push({
      date: (r[c.date] ?? "").trim(),
      start: (r[c.start] ?? "").trim(),
      end: (r[c.end] ?? "").trim(),
      driverName: name,
      driverId: match?.id ?? null,
      driverMdd: match?.mdd ?? null,
      driverArea: match?.area ?? null,
      status: (r[c.status] ?? "").trim(),
      run: (r[c.run] ?? "").trim(),
      uploadedAt: (r[c.uploaded] ?? "").trim(),
    });
  }
  return {
    configured: true,
    trips,
    uploadedAt: trips[0]?.uploadedAt ?? null,
    unresolved,
    source: "sheet",
  };
}
