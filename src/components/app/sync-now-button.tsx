"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncWorkspaceNow } from "@/lib/actions/connections";

/**
 * Pulls fresh campaigns, metrics, ad-set targeting (city) and leads from the ad
 * platforms for the current workspace, on demand — instead of waiting for the
 * nightly cron.
 */
export function SyncNowButton({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const sync = () =>
    startTransition(async () => {
      const t = toast.loading("Syncing latest data from Meta…");
      const res = await syncWorkspaceNow(workspaceId);
      if (!res.ok) {
        toast.error(res.message, { id: t });
        return;
      }
      toast.success(
        `Synced ${res.connections} connection${res.connections === 1 ? "" : "s"}.`,
        { id: t },
      );
      router.refresh();
    });

  return (
    <Button variant="outline" onClick={sync} disabled={pending}>
      {pending ? (
        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-1 h-4 w-4" />
      )}
      {pending ? "Syncing…" : "Sync now"}
    </Button>
  );
}
