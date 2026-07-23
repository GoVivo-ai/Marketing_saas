"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { isPlatformAdmin } from "@/lib/permissions";
import { setSecret, type SecretKey } from "@/lib/settings";

const ALLOWED_KEYS: SecretKey[] = ["meta_access_token", "anthropic_api_key"];

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
