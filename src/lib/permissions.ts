import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export type Role = "developer" | "agency_admin" | "agency_member" | "client";

/** Per-company role of a client user (stored on workspace_members). */
export type WorkspaceRole = "admin" | "supervisor" | "agent";

/**
 * Platform admins: agency admins plus developers. A developer is a platform
 * engineer — everywhere an agency admin is allowed, a developer is too, and
 * only developers get the /dev dashboard (maintenance mode, system status).
 */
export const isPlatformAdmin = (role: Role | string | undefined) =>
  role === "agency_admin" || role === "developer";

export async function currentUser(): Promise<{ id: string; role: Role } | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const role = ((session.user as { role?: string }).role ?? "client") as Role;
  return { id, role };
}

export const isAgency = (role: Role | undefined) =>
  role === "agency_admin" || role === "agency_member" || role === "developer";

/** The user's role inside a specific workspace (admin | supervisor | agent), or null. */
export async function getWorkspaceRole(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const [m] = await db()
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.userId, userId),
        eq(schema.workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return m?.role ?? null;
}

/**
 * Who may manage a workspace's configuration (connections, AI key, company
 * profile, org users): Vivo admins or the company's supervisors/admins.
 * Agents — Vivo's own calling agents (agency_member) included — never manage.
 */
export async function canManageWorkspace(workspaceId: string): Promise<boolean> {
  const u = await currentUser();
  if (!u) return false;
  if (isPlatformAdmin(u.role)) return true;
  if (u.role === "agency_member") return false;
  const wsRole = await getWorkspaceRole(u.id, workspaceId);
  return wsRole === "admin" || wsRole === "supervisor";
}

/**
 * True when the current user is an agent inside the given workspace: they only
 * get Leads, Contact Queue and Pipeline. Vivo's agency_member accounts ARE the
 * calling agents, so they're agents everywhere; agency admins never are.
 */
export async function isWorkspaceAgent(workspaceId: string): Promise<boolean> {
  const u = await currentUser();
  if (!u) return false;
  if (u.role === "agency_member") return true;
  if (isPlatformAdmin(u.role)) return false;
  return (await getWorkspaceRole(u.id, workspaceId)) === "agent";
}

/**
 * Page guard for everything outside Leads / Contact Queue / Pipeline: agents
 * are sent to their queue. Call at the top of each restricted page.
 */
export async function requireFullAccess(workspaceId: string | null | undefined) {
  if (!workspaceId) return;
  if (await isWorkspaceAgent(workspaceId)) redirect("/leads/queue");
}

/**
 * True when the user is an agent and nothing more — they may only change
 * their own password, never touch telephony tokens/connections. Vivo's
 * agency_member accounts are agents; client users qualify when every
 * workspace membership of theirs is 'agent'.
 */
export async function isAgentOnly(): Promise<boolean> {
  const u = await currentUser();
  if (!u) return false;
  if (u.role === "agency_member") return true;
  if (isPlatformAdmin(u.role)) return false;
  const memberships = await db()
    .select({ role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, u.id));
  return memberships.length > 0 && memberships.every((m) => m.role === "agent");
}
