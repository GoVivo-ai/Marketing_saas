/**
 * Dispatch module data layer — the driver master, ride covers and compliance
 * interactions that replace the ops team's loose spreadsheets. Everything is
 * keyed by the driver's MDD (EverDriven id); rows imported from the old files
 * keep the raw names so nothing is lost when a name didn't resolve.
 */
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";

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
