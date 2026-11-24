import { desc, eq, inArray, isNotNull, and, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Matching a phone number to a lead must never cross client boundaries: a
 * client user's call or SMS may only ever land on (or reveal) a lead in a
 * workspace they belong to. Every phone → lead lookup goes through here.
 */

/** Last 10 digits — tolerant of +1/formatting differences between the ad
 *  platform's lead phone and the carrier's E.164. */
export const phoneKey = (raw: string | null | undefined): string | null => {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
};

/**
 * Workspaces whose leads a user may be matched to. `null` means every
 * workspace — Vivo's agency roles, the same rule requireLeadAccess applies.
 * Client users get their memberships; dispatch-only users get none.
 */
export async function leadWorkspaceScope(userId: string): Promise<string[] | null> {
  const [u] = await db()
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!u) return [];
  if (u.role === "agency_admin" || u.role === "agency_member" || u.role === "developer")
    return null;
  if (u.role === "operations") return [];
  const rows = await db()
    .select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, userId));
  return rows.map((r) => r.workspaceId);
}

export type LeadRef = { leadId: string; workspaceId: string };

/**
 * Newest lead with this number inside the scope. `preferWorkspaceId` (the
 * caller's active workspace) wins when it has a match, so an agency agent
 * working one client is not attributed to another client's newer lead.
 */
export async function matchLeadByPhone(
  phone: string | null | undefined,
  scope: string[] | null,
  preferWorkspaceId?: string | null,
): Promise<LeadRef | null> {
  const key = phoneKey(phone);
  if (!key || (scope && scope.length === 0)) return null;
  const rows = await db()
    .select({ leadId: schema.leads.id, workspaceId: schema.leads.workspaceId })
    .from(schema.leads)
    .where(
      and(
        sql`right(regexp_replace(${schema.leads.phone}, '\\D', '', 'g'), 10) = ${key}`,
        scope ? inArray(schema.leads.workspaceId, scope) : undefined,
      ),
    )
    .orderBy(desc(schema.leads.createdAt))
    .limit(50);
  return pickLead(rows, preferWorkspaceId);
}

function pickLead(rows: LeadRef[], preferWorkspaceId?: string | null): LeadRef | null {
  if (preferWorkspaceId) {
    const preferred = rows.find((r) => r.workspaceId === preferWorkspaceId);
    if (preferred) return preferred;
  }
  return rows[0] ?? null;
}

/**
 * In-memory phone → leads index for the bulk call-log syncs. Keeps every
 * lead per number (newest first) so each call can be matched within its own
 * user's scope instead of to whichever client's lead happens to be newest.
 */
export async function buildLeadPhoneIndex() {
  const rows = await db()
    .select({
      leadId: schema.leads.id,
      workspaceId: schema.leads.workspaceId,
      phone: schema.leads.phone,
    })
    .from(schema.leads)
    .where(isNotNull(schema.leads.phone))
    .orderBy(desc(schema.leads.createdAt));
  const byKey = new Map<string, LeadRef[]>();
  for (const r of rows) {
    const key = phoneKey(r.phone);
    if (!key) continue;
    const list = byKey.get(key);
    const ref = { leadId: r.leadId, workspaceId: r.workspaceId };
    if (list) list.push(ref);
    else byKey.set(key, [ref]);
  }

  const scopes = new Map<string, Promise<string[] | null>>();
  return {
    /** Lead for `phone` that `userId` may be attributed to, or null. */
    async match(phone: string | null | undefined, userId: string): Promise<LeadRef | null> {
      const list = byKey.get(phoneKey(phone) ?? "");
      if (!list) return null;
      let scope = scopes.get(userId);
      if (!scope) scopes.set(userId, (scope = leadWorkspaceScope(userId)));
      const allowed = await scope;
      return pickLead(allowed ? list.filter((l) => allowed.includes(l.workspaceId)) : list);
    },
  };
}

export type LeadPhoneIndex = Awaited<ReturnType<typeof buildLeadPhoneIndex>>;
