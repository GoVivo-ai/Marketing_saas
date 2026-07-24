"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncCallLogsNow } from "@/lib/actions/call-log";

/**
 * Pulls the latest RingCentral call log for every connected user, on demand —
 * instead of waiting for the nightly cron.
 */
export function SyncCallsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const sync = () =>
    startTransition(async () => {
      const t = toast.loading("Syncing calls from RingCentral…");
      const res = await syncCallLogsNow();
      if (!res.ok) {
        toast.error(res.message, { id: t });
        return;
      }
      const { users, calls, matched, errors } = res.stats;
      toast.success(
        `Synced ${calls} call${calls === 1 ? "" : "s"} from ${users} user${users === 1 ? "" : "s"} · ${matched} matched to leads.`,
        { id: t },
      );
      for (const e of errors) toast.error(e);
      router.refresh();
    });

  return (
    <Button variant="outline" onClick={sync} disabled={pending}>
      {pending ? (
        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
      ) : (
        <PhoneCall className="mr-1 h-4 w-4" />
      )}
      {pending ? "Syncing…" : "Sync calls"}
    </Button>
  );
}
