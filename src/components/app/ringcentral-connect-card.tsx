"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Phone, Plug, Unplug, FlaskConical } from "lucide-react";
import {
  disconnectRingCentral,
  setRingCentralEnvironment,
} from "@/lib/actions/ringcentral";
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
  connected: { type: "success", text: "RingCentral connected." },
  connected_no_sms: {
    type: "info",
    text: "RingCentral connected, but your number can't send SMS — calls will work.",
  },
  error: { type: "error", text: "Could not connect RingCentral. Try again." },
  invalid_state: { type: "error", text: "RingCentral session expired. Try again." },
  not_configured: {
    type: "error",
    text: "RingCentral is not configured on this server.",
  },
};

export function RingCentralConnectCard({
  connected,
  fromNumber,
  isAdmin = false,
  env = "production",
  envConfigured = true,
}: {
  connected: boolean;
  fromNumber: string | null;
  /** Agency admins can switch the global Production/Sandbox environment. */
  isAdmin?: boolean;
  env?: "production" | "sandbox";
  /** Whether the active environment has its Client ID/Secret set on the server. */
  envConfigured?: boolean;
}) {
  const params = useSearchParams();

  useEffect(() => {
    const rc = params.get("rc");
    if (!rc) return;
    const msg = MESSAGES[rc];
    if (msg) toast[msg.type](msg.text);
    // Clean the query param so the toast doesn't re-fire on refresh.
    window.history.replaceState(null, "", "/settings/general");
  }, [params]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Phone className="h-4 w-4 text-primary" />
          RingCentral
        </CardTitle>
        <CardDescription>
          Connect your own RingCentral account to call and text leads directly
          from the platform. Calls ring your RingCentral phone first, then dial
          the lead.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isAdmin && (
          <div className="mb-4 rounded-lg border border-dashed p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <FlaskConical className="h-3.5 w-3.5 text-primary" />
                  Environment
                </p>
                <p className="text-xs text-muted-foreground">
                  Agency-wide. Sandbox uses RingCentral test accounts only.
                </p>
              </div>
              <div className="flex gap-1">
                {(["production", "sandbox"] as const).map((e) => (
                  <form key={e} action={setRingCentralEnvironment}>
                    <input type="hidden" name="env" value={e} />
                    <Button
                      type="submit"
                      size="sm"
                      variant={env === e ? "default" : "outline"}
                      disabled={env === e}
                    >
                      {e === "production" ? "Production" : "Sandbox"}
                    </Button>
                  </form>
                ))}
              </div>
            </div>
            {!envConfigured && (
              <p className="mt-2 text-xs text-destructive">
                The {env} environment is missing its Client ID/Secret on the
                server. Add the credentials before connecting.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Switching environments invalidates current connections — users
              will need to reconnect.
            </p>
          </div>
        )}
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
            <form action={disconnectRingCentral} className="flex-1">
              <Button variant="ghost" size="sm" type="submit">
                <Unplug className="mr-1 h-3.5 w-3.5" />
                Disconnect
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              Not connected. You&apos;ll be redirected to RingCentral to sign in.
            </p>
            <Button size="sm" render={<a href="/api/ringcentral/start" />}>
              <Plug className="mr-1 h-3.5 w-3.5" />
              Connect RingCentral
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
