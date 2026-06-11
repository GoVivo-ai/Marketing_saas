import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export type Role = "agency_admin" | "agency_member" | "client";

export async function currentUser(): Promise<{ id: string; role: Role } | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const role = ((session.user as { role?: string }).role ?? "client") as Role;
  return { id, role };
}

export const isAgency = (role: Role | undefined) =>
  role === "agency_admin" || role === "agency_member";

/** The user's role inside a specific workspace (owner | editor | viewer), or null. */
export async function getWorkspaceRole(
  userId: string,
  workspaceId: string,
): Promise<string | null> {
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
 * profile, org users): the Vivo team (any agency role) or the workspace owner.
 */
export async function canManageWorkspace(workspaceId: string): Promise<boolean> {
  const u = await currentUser();
  if (!u) return false;
  if (isAgency(u.role)) return true;
  return (await getWorkspaceRole(u.id, workspaceId)) === "owner";
}
