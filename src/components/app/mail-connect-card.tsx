"use client";

import { Mail, Plug, Unplug } from "lucide-react";
import { disconnectMailAccount } from "@/lib/actions/mail";
import { MAIL_PROVIDER_LABEL, type MailProvider } from "@/lib/integrations/mail";
import type { MailAccountSummary } from "@/lib/mail-accounts";
import { useMailConnectToast } from "@/components/app/mail-connect-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Settings card: connect / disconnect the user's own Gmail or Outlook. */
export function MailConnectCard({
  account,
  providers,
}: {
  account: MailAccountSummary | null;
  /** Providers the server has credentials for. */
  providers: MailProvider[];
}) {
  useMailConnectToast();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4 text-primary" />
          Email
        </CardTitle>
        <CardDescription>
          Connect your own Gmail or Outlook to email leads from the Contact
          Queue and the lead page. Emails go out from your address, replies
          reach your inbox, and each send is logged on the lead.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {account ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
            <div className="min-w-44">
              <p className="text-sm font-medium">
                Connected · {MAIL_PROVIDER_LABEL[account.provider]}
              </p>
              <Badge variant="secondary" className="mt-1">
                {account.address}
              </Badge>
              {account.lastError && (
                <p className="mt-2 text-xs text-destructive">
                  Last attempt failed: {account.lastError}
                </p>
              )}
            </div>
            <form action={disconnectMailAccount} className="flex-1">
              <Button variant="ghost" size="sm" type="submit">
                <Unplug className="mr-1 h-3.5 w-3.5" />
                Disconnect
              </Button>
            </form>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <p className="text-sm text-muted-foreground">
              {providers.length > 0
                ? "Not connected. You'll be asked to sign in and allow sending."
                : "No email provider is configured on this server."}
            </p>
            <div className="flex flex-wrap gap-2">
              {providers.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={p === providers[0] ? "default" : "outline"}
                  render={
                    <a href={`/api/mail/${p}/start?return=${encodeURIComponent("/settings/general")}`} />
                  }
                >
                  <Plug className="mr-1 h-3.5 w-3.5" />
                  Connect {MAIL_PROVIDER_LABEL[p]}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
