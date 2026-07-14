import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export type Role = "agency_admin" | "agency_member" | "client";

/** Per-company role of a client user (stored on workspace_members). */
export type WorkspaceRole = "admin" | "supervisor" | "agent";

export async function currentUser(): Promise<{ id: string; role: Role } | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const role = ((session.user as { role?: string }).role ?? "client") as Role;
  return { id, role };
}

export const isAgency = (role: Role | undefined) =>
  role === "agency_admin" || role === "agency_member";

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
 * profile, org users): the Vivo team (any agency role) or the company's
 * supervisors/admins. Agents never manage anything.
 */
export async function canManageWorkspace(workspaceId: string): Promise<boolean> {
  const u = await currentUser();
  if (!u) return false;
  if (isAgency(u.role)) return true;
  const wsRole = await getWorkspaceRole(u.id, workspaceId);
  return wsRole === "admin" || wsRole === "supervisor";
}

/**
 * True when the current user is an agent inside the given workspace: they only
 * get Leads, Contact Queue and Pipeline. Agency users are never agents.
 */
export async function isWorkspaceAgent(workspaceId: string): Promise<boolean> {
  const u = await currentUser();
  if (!u || isAgency(u.role)) return false;
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
