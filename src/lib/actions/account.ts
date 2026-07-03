"use server";

import { compare, hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export interface ChangePasswordState {
  error?: string;
  success?: boolean;
}

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: "Not authenticated." };

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (next.length < 10) {
    return { error: "New password must be at least 10 characters long." };
  }
  // bcrypt silently truncates input past 72 bytes — reject instead so no one
  // believes the tail of a long passphrase counts.
  if (Buffer.byteLength(next, "utf8") > 72) {
    return { error: "New password is too long (72 characters max)." };
  }
  if (next === current) {
    return { error: "New password must be different from the current one." };
  }
  if (next !== confirm) {
    return { error: "New password and confirmation do not match." };
  }

  const [user] = await db()
    .select({ passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user?.passwordHash || !(await compare(current, user.passwordHash))) {
    return { error: "Current password is incorrect." };
  }

  await db()
    .update(schema.users)
    .set({ passwordHash: await hash(next, 12) })
    .where(eq(schema.users.id, userId));

  return { success: true };
}
