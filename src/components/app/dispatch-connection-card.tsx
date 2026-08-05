"use client";

import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { CircleCheck, Loader2, PlugZap, Trash2 } from "lucide-react";
import {
  saveDispatchConnection,
  deleteDispatchConnection,
  testDispatchConnection,
  type DispatchConnState,
} from "@/lib/actions/dispatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const initial: DispatchConnState = {};

/**
 * Per-workspace Microsoft SharePoint connection for the Dispatch module.
 * The client's M365 admin registers an Entra app (Sites.Selected, granted to
 * the one site holding their interactions list) and pastes the ids here.
 */
export function DispatchConnectionCard({
  workspaceId,
  existing,
}: {
  workspaceId: string;
  existing: {
    tenantId: string;
    clientId: string;
    siteUrl: string;
    listName: string;
    lastSyncedAt: string | null;
  } | null;
}) {
  const [state, action, pending] = useActionState(saveDispatchConnection, initial);
  const [testing, startTest] = useTransition();

  const onTest = () =>
    startTest(async () => {
      const r = await testDispatchConnection(workspaceId);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlugZap className="h-4 w-4 text-primary" />
          Microsoft SharePoint (Dispatch)
        </CardTitle>
        <CardDescription>
          Connects this workspace&apos;s Driver Incidents list. Your Microsoft 365
          admin registers an app in Entra (permission{" "}
          <code className="font-mono text-xs">Sites.Selected</code>, granted to the
          site) and you paste its ids here — credentials are stored encrypted and
          verified before saving.
          {existing?.lastSyncedAt
            ? ` Last sync: ${existing.lastSyncedAt}.`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <div className="grid gap-1.5">
            <Label htmlFor="dc-tenant">Tenant ID</Label>
            <Input
              id="dc-tenant"
              name="tenantId"
              defaultValue={existing?.tenantId ?? ""}
              placeholder="45e961be-…"
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dc-client">Client ID</Label>
            <Input
              id="dc-client"
              name="clientId"
              defaultValue={existing?.clientId ?? ""}
              placeholder="523add83-…"
              required
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="dc-secret">Client secret</Label>
            <Input
              id="dc-secret"
              name="clientSecret"
              type="password"
              placeholder={existing ? "•••••• (leave blank to keep current)" : "Secret value from Entra"}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dc-site">SharePoint site URL</Label>
            <Input
              id="dc-site"
              name="siteUrl"
              defaultValue={existing?.siteUrl ?? ""}
              placeholder="https://company.sharepoint.com/sites/Ops"
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dc-list">List name or id</Label>
            <Input
              id="dc-list"
              name="listName"
              defaultValue={existing?.listName ?? ""}
              placeholder="Driver Incidents Report"
              required
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <CircleCheck className="mr-1.5 h-4 w-4" />
              )}
              {existing ? "Save changes" : "Connect"}
            </Button>
            {existing && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={testing}
                  onClick={onTest}
                >
                  {testing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Test connection
                </Button>
                <Button
                  type="submit"
                  variant="ghost"
                  formAction={deleteDispatchConnection}
                  className="ml-auto text-destructive hover:text-destructive/80"
                  onClick={(e) => {
                    if (!confirm("Disconnect SharePoint? Synced data stays."))
                      e.preventDefault();
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </>
            )}
          </div>
          {state.error && (
            <p className="text-sm text-destructive sm:col-span-2">{state.error}</p>
          )}
          {state.success && (
            <p className="text-sm text-success sm:col-span-2">{state.success}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
