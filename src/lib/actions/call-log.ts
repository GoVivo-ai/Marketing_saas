"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/permissions";
import { syncAllCallLogs, type CallLogSyncStats } from "@/lib/call-log-sync";

export type SyncCallLogsResult =
  | { ok: true; stats: CallLogSyncStats }
  | { ok: false; message: string };

/**
 * On-demand RingCentral call-log sync from the Agent Activity report.
 * The sync walks every RingCentral account on the platform, across all
 * clients, so only Vivo's own staff may trigger it — never a client user,
 * whatever their role inside their company.
 */
export async function syncCallLogsNow(): Promise<SyncCallLogsResult> {
  const u = await currentUser();
  if (!u || u.role === "client" || u.role === "operations")
    return { ok: false, message: "You don't have permission to sync calls" };

  try {
    const stats = await syncAllCallLogs();
    revalidatePath("/reports/agents");
    revalidatePath("/reports/calls");
    return { ok: true, stats };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
