"use server";

import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { isPlatformAdmin } from "@/lib/permissions";

export interface AdminActionState {
  error?: string;
  success?: string;
  /** Shown exactly once after creating/resetting an account. */
  tempPassword?: string;
}

async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!isPlatformAdmin(role)) {
    return { ok: false, error: "Only agency admins can do this." };
  }
  return { ok: true };
}

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

// ─────────────────────────────────────────────────────────────────────────
// Workspaces
// ─────────────────────────────────────────────────────────────────────────

export async function createWorkspace(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Workspace name is required." };
  const industry = String(formData.get("industry") ?? "").trim() || null;
  const accentColor = String(formData.get("accentColor") ?? "").trim() || null;

  const existing = await db()
    .select({ slug: schema.workspaces.slug })
    .from(schema.workspaces);
  const taken = new Set(existing.map((w) => w.slug));
  let slug = slugify(name) || "client";
  if (taken.has(slug)) {
    let i = 2;
    while (taken.has(`${slug}-${i}`)) i++;
    slug = `${slug}-${i}`;
  }

  await db().insert(schema.workspaces).values({ name, slug, industry, accentColor });
  revalidatePath("/", "layout");
  return { success: `Workspace "${name}" created.` };
}

/** Hide/restore a workspace everywhere (data is kept). */
export async function setWorkspaceActive(formData: FormData) {
  const gate = await requireAdmin();
  if (!gate.ok) throw new Error(gate.error);

  const workspaceId = String(formData.get("workspaceId") ?? "");
  const isActive = String(formData.get("isActive") ?? "") === "true";
  if (!workspaceId) throw new Error("Missing workspace");

  await db()
    .update(schema.workspaces)
    .set({ isActive })
    .where(eq(schema.workspaces.id, workspaceId));
  revalidatePath("/", "layout");
}

/**
 * Permanently deletes a workspace and ALL its data (connections, campaigns,
 * metrics, leads, insights) via DB cascades. Irreversible.
 */
export async function deleteWorkspace(formData: FormData) {
  const gate = await requireAdmin();
  if (!gate.ok) throw new Error(gate.error);

  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!workspaceId) throw new Error("Missing workspace");

  await db().delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  revalidatePath("/", "layout");
}

// ─────────────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────────────

const USER_ROLES = ["client", "agency_member", "agency_admin", "developer"] as const;
type UserRole = (typeof USER_ROLES)[number];

export async function createUser(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "client") as UserRole;
  const workspaceId = String(formData.get("workspaceId") ?? "");

  if (!name || !email) return { error: "Name and email are required." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Invalid email." };
  if (!USER_ROLES.includes(role)) return { error: "Invalid role." };
  if (role === "client" && !workspaceId) {
    return { error: "Client accounts must be assigned to a workspace." };
  }

  const [existing] = await db()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing) return { error: `An account with ${email} already exists.` };

  const tempPassword = randomBytes(9).toString("base64url");
  const [user] = await db()
    .insert(schema.users)
    .values({ name, email, role, passwordHash: await hash(tempPassword, 12) })
    .returning({ id: schema.users.id });

  if (role === "client" && workspaceId) {
    // Client users get a per-company role. The first user of a workspace is
    // always its admin (someone must be able to self-manage the org).
    const WS_ROLES = ["admin", "supervisor", "agent"] as const;
    const requested = String(formData.get("wsRole") ?? "agent");
    const wsRole = (WS_ROLES as readonly string[]).includes(requested)
      ? (requested as (typeof WS_ROLES)[number])
      : "agent";
    const [existingAdmin] = await db()
      .select({ id: schema.workspaceMembers.id })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, workspaceId),
          eq(schema.workspaceMembers.role, "admin"),
        ),
      )
      .limit(1);
    await db()
      .insert(schema.workspaceMembers)
      .values({
        workspaceId,
        userId: user.id,
        role: existingAdmin ? wsRole : "admin",
      })
      .onConflictDoNothing();
  }

  revalidatePath("/settings/team");
  return {
    success: `Account created for ${email}. Share the temporary password now — it is shown only once.`,
    tempPassword,
  };
}

export async function resetUserPassword(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const gate = await requireAdmin();
  if (!gate.ok) return { error: gate.error };

  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "Missing user." };

  const [user] = await db()
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return { error: "User not found." };

  const tempPassword = randomBytes(9).toString("base64url");
  await db()
    .update(schema.users)
    .set({ passwordHash: await hash(tempPassword, 12) })
    .where(eq(schema.users.id, userId));

  return {
    success: `Password reset for ${user.email}. Share it now — shown only once.`,
    tempPassword,
  };
}

/** Permanently deletes a user account (memberships cascade). Admins only. */
export async function deleteUser(formData: FormData) {
  const gate = await requireAdmin();
  if (!gate.ok) throw new Error(gate.error);

  const userId = String(formData.get("userId") ?? "");
  if (!userId) throw new Error("Missing user");

  const session = await auth();
  if (session?.user?.id === userId) {
    throw new Error("You can't delete your own account.");
  }

  await db().delete(schema.users).where(eq(schema.users.id, userId));
  revalidatePath("/settings/team");
}
