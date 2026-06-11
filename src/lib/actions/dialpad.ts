"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { clearDialpadTokens } from "@/lib/settings";

/** Disconnects the current user's own Dialpad account. Self-service. */
export async function disconnectDialpad() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  await clearDialpadTokens(session.user.id);
  revalidatePath("/settings/general");
}
