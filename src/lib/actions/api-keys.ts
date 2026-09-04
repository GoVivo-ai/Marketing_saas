"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { generateApiKey, listApiKeys, MAX_ACTIVE_KEYS } from "@/lib/api-keys";
import { isDemoSession, DEMO_BLOCKED_MSG } from "@/lib/demo";
import { rateLimit } from "@/lib/rate-limit";
import { revokeConnectedApp } from "@/lib/oauth";

export interface ApiKeyActionState {
  error?: string;
  /** Plaintext token, returned exactly once right after creation. */
  token?: string;
  tokenName?: string;
}

/** Mints a personal read-only API key for the signed-in user. */
export async function createApiKey(
  _prev: ApiKeyActionState,
  formData: FormData,
): Promise<ApiKeyActionState> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: "Not authenticated." };
  if (await isDemoSession()) return { error: DEMO_BLOCKED_MSG };
  if (!rateLimit(`api-key-create:${userId}`, 10, 60 * 60_000)) {
    return { error: "Too many keys created recently. Try again later." };
  }

  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  if (!name) return { error: "Give the key a name (e.g. \"Claude Code – laptop\")." };

  const existing = await listApiKeys(userId);
  if (existing.length >= MAX_ACTIVE_KEYS) {
    return {
      error: `You already have ${MAX_ACTIVE_KEYS} active keys. Revoke one before creating another.`,
    };
  }

  const { token, keyHash, keyPrefix } = generateApiKey();
  await db().insert(schema.apiKeys).values({ userId, name, keyHash, keyPrefix });
  revalidatePath("/settings/general");
  return { token, tokenName: name };
}

/** Revokes one of the signed-in user's keys. Only the owner can revoke. */
export async function revokeApiKey(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not authenticated.");
  if (await isDemoSession()) throw new Error(DEMO_BLOCKED_MSG);

  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db()
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.apiKeys.id, id),
        eq(schema.apiKeys.userId, userId),
        isNull(schema.apiKeys.revokedAt),
      ),
    );
  revalidatePath("/settings/general");
}

/** Disconnects an OAuth-authorized app (revokes its token pair). */
export async function disconnectApp(formData: FormData): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not authenticated.");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await revokeConnectedApp(userId, id);
  revalidatePath("/settings/general");
}
