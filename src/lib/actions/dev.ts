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

  // Optional scheduled window — the client submits ISO datetimes (UTC).
  const rawStart = String(formData.get("scheduledStart") ?? "").trim();
  const rawEnd = String(formData.get("scheduledEnd") ?? "").trim();
  let scheduledStart: string | null = null;
  let scheduledEnd: string | null = null;
  if (rawStart || rawEnd) {
    if (!rawStart || !rawEnd) {
      return { error: "A scheduled window needs both a start and an end." };
    }
    const start = Date.parse(rawStart);
    const end = Date.parse(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return { error: "Invalid scheduled window dates." };
    }
    if (end <= start) {
      return { error: "The window must end after it starts." };
    }
    if (end <= Date.now()) {
      return { error: "The scheduled window is entirely in the past." };
    }
    scheduledStart = new Date(start).toISOString();
    scheduledEnd = new Date(end).toISOString();
  }

  const current = await getMaintenance();
  if (
    current.enabled === enabled &&
    current.message === message &&
    current.scheduledStart === scheduledStart &&
    current.scheduledEnd === scheduledEnd
  ) {
    return { success: "No changes." };
  }

  await setMaintenance({
    enabled,
    message,
    scheduledStart,
    scheduledEnd,
    updatedBy: gate.name,
    updatedAt: new Date().toISOString(),
  });
  // The flag gates the whole app shell, so everything revalidates.
  revalidatePath("/", "layout");
  if (enabled) return { success: "Maintenance mode is ON." };
  if (scheduledStart) return { success: "Maintenance window scheduled." };
  return { success: "Maintenance mode is off." };
}
