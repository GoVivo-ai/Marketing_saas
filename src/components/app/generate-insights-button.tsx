"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function GenerateInsightsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const generate = () =>
    startTransition(async () => {
      setMessage(null);
      const res = await fetch("/api/ai/insights", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error ?? "Something went wrong generating insights.");
        return;
      }
      if (body.message) setMessage(body.message);
      router.refresh();
    });

  return (
    <div className="flex items-center gap-3">
      <Button onClick={generate} disabled={pending}>
        {pending ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="mr-1 h-4 w-4" />
        )}
        {pending ? "Analyzing…" : "Generate insights"}
      </Button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
