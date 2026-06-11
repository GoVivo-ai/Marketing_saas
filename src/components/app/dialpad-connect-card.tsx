"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Phone, Plug, Unplug } from "lucide-react";
import { disconnectDialpad } from "@/lib/actions/dialpad";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const MESSAGES: Record<string, { type: "success" | "error" | "info"; text: string }> = {
  connected: { type: "success", text: "Dialpad connected." },
  error: { type: "error", text: "Could not connect Dialpad. Try again." },
  invalid_state: { type: "error", text: "Dialpad session expired. Try again." },
  not_configured: {
    type: "error",
    text: "Dialpad is not configured on this server.",
  },
};

export function DialpadConnectCard({
  connected,
  fromNumber,
}: {
  connected: boolean;
  fromNumber: string | null;
}) {
  const params = useSearchParams();

  useEffect(() => {
    const dp = params.get("dp");
    if (!dp) return;
    const msg = MESSAGES[dp];
    if (msg) toast[msg.type](msg.text);
    // Clean the query param so the toast doesn't re-fire on refresh.
    window.history.replaceState(null, "", "/settings/general");
  }, [params]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Phone className="h-4 w-4 text-primary" />
          Dialpad
        </CardTitle>
        <CardDescription>
          Connect your own Dialpad account to call and text leads directly from
          the platform. Calls ring your Dialpad app or phone first, then dial the
          lead.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {connected ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
            <div className="min-w-44">
              <p className="text-sm font-medium">Connected</p>
              {fromNumber ? (
                <Badge variant="secondary" className="mt-1">
                  {fromNumber}
                </Badge>
              ) : (
                <Badge variant="destructive" className="mt-1">
                  No number found
                </Badge>
              )}
            </div>
            <form action={disconnectDialpad} className="flex-1">
              <Button variant="ghost" size="sm" type="submit">
                <Unplug className="mr-1 h-3.5 w-3.5" />
                Disconnect
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              Not connected. You&apos;ll be redirected to Dialpad to sign in.
            </p>
            <Button size="sm" render={<a href="/api/dialpad/start" />}>
              <Plug className="mr-1 h-3.5 w-3.5" />
              Connect Dialpad
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
