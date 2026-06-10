"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { clearRingCentralTokens } from "@/lib/settings";

/** Disconnects the current user's own RingCentral account. Self-service. */
export async function disconnectRingCentral() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  await clearRingCentralTokens(session.user.id);
  revalidatePath("/settings/general");
}
