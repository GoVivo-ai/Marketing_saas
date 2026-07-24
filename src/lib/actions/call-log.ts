"use server";

import { revalidatePath } from "next/cache";
import { currentUser, isAgentOnly } from "@/lib/permissions";
import { syncAllCallLogs, type CallLogSyncStats } from "@/lib/call-log-sync";

export type SyncCallLogsResult =
  | { ok: true; stats: CallLogSyncStats }
  | { ok: false; message: string };

/**
 * On-demand RingCentral call-log sync from the Agent Activity report.
 * Any supervisor/admin may trigger it; agents can't reach the report at all,
 * but the guard stands on its own anyway.
 */
export async function syncCallLogsNow(): Promise<SyncCallLogsResult> {
  const u = await currentUser();
  if (!u || (await isAgentOnly()))
    return { ok: false, message: "You don't have permission to sync calls" };

  try {
    const stats = await syncAllCallLogs();
    revalidatePath("/reports/agents");
    return { ok: true, stats };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
