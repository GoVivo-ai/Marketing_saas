import { formatDistanceToNow } from "date-fns";
import { RefreshCw, Unplug, CircleCheck, KeyRound } from "lucide-react";
import { auth } from "@/lib/auth";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { metaConnector } from "@/lib/integrations/meta";
import { getSecret, getSecretPreview } from "@/lib/settings";
import {
  connectMetaAccount,
  disconnectConnection,
  syncConnectionNow,
} from "@/lib/actions/connections";
import { savePlatformSecret } from "@/lib/actions/settings";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const upcomingPlatforms = [
  { name: "Google Ads", description: "Search, Display, YouTube and Performance Max", detail: "Phase 2" },
  { name: "TikTok Ads", description: "TikTok campaign performance and lead forms", detail: "Phase 3" },
  { name: "LinkedIn Ads", description: "B2B campaigns and Lead Gen Forms", detail: "Phase 3" },
];

export default async function ConnectionsPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isAgency = role === "agency_admin" || role === "agency_member";

  if (!isAgency) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Platform connections are managed by the Vivo team. Contact your account
          manager to connect or change an ad account.
        </p>
      </div>
    );
  }

  const isAdmin = role === "agency_admin";
  const metaToken = isDatabaseConfigured() ? await getSecret("meta_access_token") : null;
  const metaPreview = metaToken ? `••••••${metaToken.slice(-4)}` : null;
  const aiPreview = isDatabaseConfigured()
    ? await getSecretPreview("anthropic_api_key")
    : null;
  const ready = isDatabaseConfigured() && Boolean(metaToken);
  let accounts: { externalId: string; name: string; currency: string }[] = [];
  let accountsError: string | null = null;
  let workspaces: { id: string; name: string }[] = [];
  let connections: {
    id: string;
    accountId: string;
    workspaceId: string;
    status: string;
    lastSyncedAt: Date | null;
  }[] = [];

  if (ready) {
    try {
      [accounts, workspaces, connections] = await Promise.all([
        metaConnector.listAccounts({
          accessToken: metaToken!,
          accountId: "",
        }),
        db()
          .select({ id: schema.workspaces.id, name: schema.workspaces.name })
          .from(schema.workspaces),
        db()
          .select({
            id: schema.connections.id,
            accountId: schema.connections.accountId,
            workspaceId: schema.connections.workspaceId,
            status: schema.connections.status,
            lastSyncedAt: schema.connections.lastSyncedAt,
          })
          .from(schema.connections),
      ]);
    } catch (err) {
      accountsError = err instanceof Error ? err.message : String(err);
    }
  }

  const workspaceName = new Map(workspaces.map((w) => [w.id, w.name]));
  // One ad account can be linked to several workspaces, so group every active
  // connection by account instead of keeping just one.
  const connectionsByAccount = new Map<string, typeof connections>();
  for (const c of connections) {
    if (c.status !== "active") continue;
    const list = connectionsByAccount.get(c.accountId) ?? [];
    list.push(c);
    connectionsByAccount.set(c.accountId, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Ad accounts shared with GoVivo&apos;s business portfolio appear here
          automatically. Link each one to its client workspace — the first sync
          runs on connect.
        </p>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              Platform credentials
            </CardTitle>
            <CardDescription>
              Agency-level keys, stored encrypted. Only admins can see or change
              them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
              <div className="min-w-44">
                <p className="text-sm font-medium">Meta system-user token</p>
                {metaPreview ? (
                  <Badge variant="secondary" className="mt-1">{metaPreview}</Badge>
                ) : (
                  <Badge variant="destructive" className="mt-1">Not configured</Badge>
                )}
              </div>
              <form action={savePlatformSecret} className="flex flex-1 items-center gap-2">
                <input type="hidden" name="key" value="meta_access_token" />
                <Input
                  name="value"
                  type="password"
                  placeholder={metaPreview ? "Replace token…" : "EAA…"}
                  className="max-w-md"
                  required
                />
                <Button size="sm" type="submit">Save</Button>
              </form>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
              <div className="min-w-44">
                <p className="text-sm font-medium">Anthropic API key (AI)</p>
                {aiPreview ? (
                  <Badge variant="secondary" className="mt-1">{aiPreview}</Badge>
                ) : (
                  <Badge variant="destructive" className="mt-1">Not configured</Badge>
                )}
              </div>
              <form action={savePlatformSecret} className="flex flex-1 items-center gap-2">
                <input type="hidden" name="key" value="anthropic_api_key" />
                <Input
                  name="value"
                  type="password"
                  placeholder={aiPreview ? "Replace key…" : "sk-ant-…"}
                  className="max-w-md"
                  required
                />
                <Button size="sm" type="submit">Save</Button>
              </form>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Meta ad accounts</CardTitle>
          <CardDescription>
            Visible to the GoVivo system user. To add a client, ask them to share
            their ad account and page as partner with the GoVivo portfolio.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!ready && (
            <p className="text-sm text-muted-foreground">
              Configure DATABASE_URL and META_ACCESS_TOKEN to enable live
              connections.
            </p>
          )}
          {accountsError && (
            <p className="text-sm text-destructive">
              Could not reach the Meta API: {accountsError}
            </p>
          )}
          {ready && !accountsError && accounts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No ad accounts visible yet. Assign accounts to the system user in
              GoVivo&apos;s Business settings.
            </p>
          )}

          {accounts.map((account) => {
            const conns = connectionsByAccount.get(account.externalId) ?? [];
            const linkedWsIds = new Set(conns.map((c) => c.workspaceId));
            const remaining = workspaces.filter((w) => !linkedWsIds.has(w.id));
            return (
              <div
                key={account.externalId}
                className="space-y-3 rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{account.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {account.externalId} · {account.currency}
                    </p>
                  </div>
                  {conns.length === 0 && (
                    <Badge variant="secondary">Not linked</Badge>
                  )}
                </div>

                {/* One row per workspace this account is linked to. */}
                {conns.map((conn) => (
                  <div key={conn.id} className="flex flex-wrap items-center gap-2">
                    <Badge className="gap-1">
                      <CircleCheck className="h-3 w-3" />
                      {workspaceName.get(conn.workspaceId) ?? "Connected"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {conn.lastSyncedAt
                        ? `synced ${formatDistanceToNow(conn.lastSyncedAt, { addSuffix: true })}`
                        : "never synced"}
                    </span>
                    <form action={syncConnectionNow}>
                      <input type="hidden" name="connectionId" value={conn.id} />
                      <Button variant="outline" size="sm" type="submit">
                        <RefreshCw className="mr-1 h-3.5 w-3.5" />
                        Sync now
                      </Button>
                    </form>
                    <form action={disconnectConnection}>
                      <input type="hidden" name="connectionId" value={conn.id} />
                      <Button variant="ghost" size="sm" type="submit">
                        <Unplug className="mr-1 h-3.5 w-3.5" />
                        Disconnect
                      </Button>
                    </form>
                  </div>
                ))}

                {/* Link this account to another workspace (admins see all). */}
                {remaining.length > 0 && (
                  <form
                    action={connectMetaAccount}
                    className={`flex flex-wrap items-center gap-2 ${conns.length > 0 ? "border-t pt-3" : ""}`}
                  >
                    <input type="hidden" name="accountId" value={account.externalId} />
                    <input type="hidden" name="accountName" value={account.name} />
                    <select
                      name="workspaceId"
                      required
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {conns.length > 0
                          ? "Link to another workspace…"
                          : "Assign to workspace…"}
                      </option>
                      {remaining.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" type="submit">
                      {conns.length > 0 ? "Add" : "Connect"}
                    </Button>
                  </form>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {upcomingPlatforms.map((p) => (
          <Card key={p.name}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{p.name}</CardTitle>
                <Badge variant="secondary">{p.detail}</Badge>
              </div>
              <CardDescription>{p.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button disabled variant="outline" size="sm">
                Coming soon
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
