"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncAlexYahNow } from "@/lib/actions/settings";

/**
 * Pulls AlexYah's driver applications into the pipeline on demand — instead
 * of waiting for the nightly cron.
 */
export function SyncAlexYahButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const sync = () =>
    startTransition(async () => {
      const t = toast.loading("Syncing applications from AlexYah…");
      const res = await syncAlexYahNow();
      if (!res.ok) {
        toast.error(res.message, { id: t });
        return;
      }
      const { fetched, created, updated, unusable } = res.stats;
      toast.success(
        `${fetched} application${fetched === 1 ? "" : "s"} · ${created} new · ${updated} updated` +
          (unusable ? ` · ${unusable} without phone or email` : ""),
        { id: t },
      );
      router.refresh();
    });

  return (
    <Button size="sm" variant="outline" onClick={sync} disabled={disabled || pending}>
      {pending ? (
        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-1 h-4 w-4" />
      )}
      {pending ? "Syncing…" : "Sync now"}
    </Button>
  );
}
