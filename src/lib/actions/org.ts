"use server";

import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { canManageWorkspace, currentUser } from "@/lib/permissions";

export interface OrgActionState {
  error?: string;
  success?: string;
  /** Shown exactly once after creating/resetting an account. */
  tempPassword?: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Returns the target user's workspace role IF they are a client member here. */
async function clientMember(
  workspaceId: string,
  userId: string,
): Promise<{ role: string } | null> {
  const [row] = await db()
    .select({ wsRole: schema.workspaceMembers.role, userRole: schema.users.role })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!row || row.userRole !== "client") return null;
  return { role: row.wsRole };
}

export async function createOrgUser(
  _prev: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!(await canManageWorkspace(workspaceId)))
    return { error: "You don't have permission to manage this organization." };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!name || !email) return { error: "Name and email are required." };
  if (!EMAIL_RE.test(email)) return { error: "Invalid email." };

  const [existing] = await db()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (existing) return { error: `An account with ${email} already exists.` };

  const tempPassword = randomBytes(9).toString("base64url");
  const [user] = await db()
    .insert(schema.users)
    .values({ name, email, role: "client", passwordHash: await hash(tempPassword, 12) })
    .returning({ id: schema.users.id });

  await db()
    .insert(schema.workspaceMembers)
    .values({ workspaceId, userId: user.id, role: "viewer" })
    .onConflictDoNothing();

  revalidatePath("/settings/team");
  return {
    success: `Account created for ${email}. Share the temporary password now — it is shown only once.`,
    tempPassword,
  };
}

export async function updateOrgUser(
  _prev: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!(await canManageWorkspace(workspaceId)))
    return { error: "You don't have permission to manage this organization." };
  if (!(await clientMember(workspaceId, userId)))
    return { error: "That user is not in your organization." };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!name || !email) return { error: "Name and email are required." };
  if (!EMAIL_RE.test(email)) return { error: "Invalid email." };

  const [clash] = await db()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (clash && clash.id !== userId)
    return { error: `Another account already uses ${email}.` };

  await db()
    .update(schema.users)
    .set({ name, email })
    .where(eq(schema.users.id, userId));
  revalidatePath("/settings/team");
  return { success: "User updated." };
}

export async function deleteOrgUser(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!(await canManageWorkspace(workspaceId)))
    throw new Error("You don't have permission to manage this organization.");

  const me = await currentUser();
  if (me?.id === userId) throw new Error("You can't delete yourself.");

  const member = await clientMember(workspaceId, userId);
  if (!member) throw new Error("That user is not in your organization.");
  if (member.role === "owner") throw new Error("The owner can't be deleted.");

  await db().delete(schema.users).where(eq(schema.users.id, userId));
  revalidatePath("/settings/team");
}

export async function resetOrgUserPassword(
  _prev: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!(await canManageWorkspace(workspaceId)))
    return { error: "You don't have permission to manage this organization." };
  if (!(await clientMember(workspaceId, userId)))
    return { error: "That user is not in your organization." };

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

/** Edits the company/workspace profile (name, industry, lead criteria). */
export async function updateWorkspaceProfile(
  _prev: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!(await canManageWorkspace(workspaceId)))
    return { error: "You don't have permission to manage this organization." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Company name is required." };
  const industry = String(formData.get("industry") ?? "").trim() || null;
  const qualificationCriteria =
    String(formData.get("qualificationCriteria") ?? "").trim() || null;
  // What this client calls a conversion/result (Sales, Hires, Appointments…).
  const resultLabel = String(formData.get("resultLabel") ?? "").trim() || "Sales";

  await db()
    .update(schema.workspaces)
    .set({ name, industry, qualificationCriteria, resultLabel })
    .where(eq(schema.workspaces.id, workspaceId));
  // Name shows in the sidebar/switcher, so refresh the whole layout.
  revalidatePath("/", "layout");
  return { success: "Company profile saved." };
}

// The logo is stored inline as a data URL (it rides in the layout RSC on every
// page), so keep it small and restrict to image types.
const LOGO_MAX_BYTES = 256 * 1024;
const LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
];

/** Stores the workspace's brand logo (shown white next to the Vivo logo). */
export async function uploadWorkspaceLogo(
  _prev: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!(await canManageWorkspace(workspaceId)))
    return { error: "You don't have permission to manage this organization." };

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0)
    return { error: "Choose an image file." };
  if (!LOGO_TYPES.includes(file.type))
    return { error: "Logo must be a PNG, JPG, WEBP, GIF or SVG." };
  if (file.size > LOGO_MAX_BYTES)
    return { error: "Logo is too large — keep it under 256 KB." };

  const buf = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${buf.toString("base64")}`;
  await db()
    .update(schema.workspaces)
    .set({ logoUrl: dataUrl })
    .where(eq(schema.workspaces.id, workspaceId));
  revalidatePath("/", "layout");
  return { success: "Logo updated." };
}

/** Clears the workspace's brand logo. */
export async function removeWorkspaceLogo(
  _prev: OrgActionState,
  formData: FormData,
): Promise<OrgActionState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!(await canManageWorkspace(workspaceId)))
    return { error: "You don't have permission to manage this organization." };

  await db()
    .update(schema.workspaces)
    .set({ logoUrl: null })
    .where(eq(schema.workspaces.id, workspaceId));
  revalidatePath("/", "layout");
  return { success: "Logo removed." };
}
