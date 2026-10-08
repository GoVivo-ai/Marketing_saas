"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/permissions";
import { setSecret, type SecretKey } from "@/lib/settings";
import { syncAlexYahApplications, type AlexYahSyncStats } from "@/lib/alexyah-sync";

const ALLOWED_KEYS: SecretKey[] = [
  "meta_access_token",
  "anthropic_api_key",
  "openai_api_key",
  "alexyah_api_key",
];

/** Saves an agency-level credential (encrypted at rest). Admins only. */
export async function savePlatformSecret(formData: FormData) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!isPlatformAdmin(role)) {
    throw new Error("Only agency admins can manage platform credentials");
  }

  const key = String(formData.get("key") ?? "") as SecretKey;
  const value = String(formData.get("value") ?? "").trim();
  if (!ALLOWED_KEYS.includes(key)) throw new Error("Unknown credential key");
  if (!value) throw new Error("Value is required");

  await setSecret(key, value);
  revalidatePath("/settings");
}

export type SyncAlexYahResult =
  | { ok: true; stats: AlexYahSyncStats }
  | { ok: false; message: string };

/**
 * On-demand AlexYah import from Settings — the first load shouldn't have to
 * wait for the nightly cron. Agency admins only, like the key itself.
 */
export async function syncAlexYahNow(): Promise<SyncAlexYahResult> {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!isPlatformAdmin(role))
    return { ok: false, message: "Only agency admins can sync AlexYah" };

  try {
    const stats = await syncAlexYahApplications("alexyah");
    if (stats.skipped) return { ok: false, message: stats.skipped };
    revalidatePath("/leads");
    return { ok: true, stats };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
