"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { getMaintenance, setMaintenance } from "@/lib/settings";

export interface DevActionState {
  error?: string;
  success?: string;
}

async function requireDeveloper(): Promise<
  { ok: true; name: string } | { ok: false; error: string }
> {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (role !== "developer") {
    return { ok: false, error: "Only developers can do this." };
  }
  return { ok: true, name: session?.user?.name ?? session?.user?.email ?? "developer" };
}

/** Flips platform-wide maintenance mode from the /dev dashboard. */
export async function setMaintenanceMode(
  _prev: DevActionState,
  formData: FormData,
): Promise<DevActionState> {
  const gate = await requireDeveloper();
  if (!gate.ok) return { error: gate.error };

  const enabled = formData.get("enabled") === "on";
  const message = String(formData.get("message") ?? "").trim().slice(0, 500) || null;

  const current = await getMaintenance();
  if (current.enabled === enabled && current.message === message) {
    return { success: "No changes." };
  }

  await setMaintenance({
    enabled,
    message,
    updatedBy: gate.name,
    updatedAt: new Date().toISOString(),
  });
  // The flag gates the whole app shell, so everything revalidates.
  revalidatePath("/", "layout");
  return {
    success: enabled ? "Maintenance mode is ON." : "Maintenance mode is off.",
  };
}
