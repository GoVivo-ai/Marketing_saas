"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  clearRingCentralTokens,
  setRingCentralEnv,
  type RingCentralEnv,
} from "@/lib/settings";

/** Disconnects the current user's own RingCentral account. Self-service. */
export async function disconnectRingCentral() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  await clearRingCentralTokens(session.user.id);
  revalidatePath("/settings/general");
}

/**
 * Switches the agency-global RingCentral environment (Production ⇄ Sandbox).
 * Admin-only. Because the two environments use different credentials, existing
 * connections made in the other environment stop working and users must
 * reconnect — the connector self-heals (clears) stale tokens on next use.
 */
export async function setRingCentralEnvironment(formData: FormData) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "agency_admin") throw new Error("Only agency admins can do this.");

  const env = formData.get("env");
  if (env !== "production" && env !== "sandbox") {
    throw new Error("Invalid environment");
  }
  await setRingCentralEnv(env as RingCentralEnv);
  revalidatePath("/settings/general");
}
