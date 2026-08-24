import { formatDistanceToNow } from "date-fns";
import { eq } from "drizzle-orm";
import { RefreshCw, Unplug, CircleCheck, KeyRound, Sparkles } from "lucide-react";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { DispatchConnectionCard } from "@/components/app/dispatch-connection-card";
import { getWorkspaceContext } from "@/lib/data";
import { canManageWorkspace, requireFullAccess } from "@/lib/permissions";
import { metaConnector } from "@/lib/integrations/meta";
import {
  getWorkspaceMetaToken,
  getWorkspaceMetaApp,
  getWorkspaceAnthropicKeyPreview,
  getSecretPreview,
} from "@/lib/settings";
import { savePlatformSecret } from "@/lib/actions/settings";
import { isPlatformAdmin } from "@/lib/permissions";
import { auth } from "@/lib/auth";
import {
  connectMetaAccount,
  disconnectConnection,
  syncConnectionNow,
  saveWorkspaceMetaToken,
  saveWorkspaceMetaApp,
  saveWorkspaceAiKey,
} from "@/lib/actions/connections";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/app/submit-button";
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
  // Each client has its own credentials; the page works in the context of the
  // selected client (from the workspace switcher).
  const { active } = await getWorkspaceContext();
  await requireFullAccess(active?.id);
  const canManage = active ? await canManageWorkspace(active.id) : false;

  if (!canManage) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="text-sm text-muted-foreground">
          Connections are managed by your organization&apos;s admin. Contact
          them to connect or change an ad account.
        </p>
      </div>
    );
  }

  const dispatchConnRow =
    isDatabaseConfigured() && active
      ? (
          await db()
            .select({
              tenantId: schema.dispatchConnections.tenantId,
              clientId: schema.dispatchConnections.clientId,
              siteUrl: schema.dispatchConnections.siteUrl,
              listName: schema.dispatchConnections.listName,
              lastSyncedAt: schema.dispatchConnections.lastSyncedAt,
            })
            .from(schema.dispatchConnections)
            .where(eq(schema.dispatchConnections.workspaceId, active.id))
            .limit(1)
        )[0] ?? null
      : null;
  const dispatchConn = dispatchConnRow
    ? {
        ...dispatchConnRow,
        lastSyncedAt: dispatchConnRow.lastSyncedAt?.toISOString() ?? null,
      }
    : null;

  const metaToken =
    isDatabaseConfigured() && active
      ? await getWorkspaceMetaToken(active.id)
      : null;
  const metaPreview = metaToken ? `••••••${metaToken.slice(-4)}` : null;
  const metaApp =
    isDatabaseConfigured() && active
      ? await getWorkspaceMetaApp(active.id)
      : { appId: null, appSecret: null };
  const metaAppSecretPreview = metaApp.appSecret
    ? `••••••${metaApp.appSecret.slice(-4)}`
    : null;
  const aiPreview =
    isDatabaseConfigured() && active
      ? await getWorkspaceAnthropicKeyPreview(active.id)
      : null;
  // Agency-wide OpenAI key (bulk lead scoring runs on it when present).
  const session = await auth();
  const platformAdmin = isPlatformAdmin(
    (session?.user as { role?: string } | undefined)?.role,
  );
  const openaiPreview =
    isDatabaseConfigured() && platformAdmin
      ? await getSecretPreview("openai_api_key")
      : null;
  const ready = isDatabaseConfigured() && Boolean(metaToken);
  let accounts: { externalId: string; name: string; currency: string }[] = [];
  let accountsError: string | null = null;
  let workspaces: { id: string; name: string }[] = [];
  let connections: {
    id: string;
    accountId: string;
    accountName: string | null;
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
            accountName: schema.connections.accountName,
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
  // Group every active connection by account.
  const connectionsByAccount = new Map<string, typeof connections>();
  for (const c of connections) {
    if (c.status !== "active") continue;
    const list = connectionsByAccount.get(c.accountId) ?? [];
    list.push(c);
    connectionsByAccount.set(c.accountId, list);
  }

  // Surface accounts that are linked in our DB but no longer returned by the
  // Meta API (the partner share was removed) so the connection isn't invisible.
  const liveIds = new Set(accounts.map((a) => a.externalId));
  const orphanAccounts = [...connectionsByAccount.entries()]
    .filter(([id]) => !liveIds.has(id))
    .map(([id, conns]) => ({
      externalId: id,
      name: conns[0].accountName ?? id,
      currency: null as string | null,
      live: false,
    }));
  const displayAccounts = [
    ...accounts.map((a) => ({ ...a, currency: a.currency as string | null, live: true })),
    ...orphanAccounts,
  ];

  // Always scoped to the selected client: only this client's accounts plus
  // unlinked ones (so they can still be assigned to it).
  const filtering = Boolean(active);
  const visibleAccounts = filtering
    ? displayAccounts.filter((acc) => {
        const conns = connectionsByAccount.get(acc.externalId) ?? [];
        if (conns.length === 0) return true; // unlinked → assignable
        return conns.some((c) => c.workspaceId === active!.id);
      })
    : displayAccounts;

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

      {active && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              Meta token · {active.name}
            </CardTitle>
            <CardDescription>
              Each client uses its own Meta system-user token (encrypted at
              rest). This token lists and syncs only {active.name}&apos;s ad
              accounts. The Meta app credentials power real-time lead delivery
              (the leadgen webhook signature is validated with the app secret).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
              <div className="min-w-44">
                <p className="text-sm font-medium">System-user token</p>
                {metaPreview ? (
                  <Badge variant="secondary" className="mt-1">{metaPreview}</Badge>
                ) : (
                  <Badge variant="destructive" className="mt-1">Not configured</Badge>
                )}
              </div>
              <form action={saveWorkspaceMetaToken} className="flex flex-1 items-center gap-2">
                <input type="hidden" name="workspaceId" value={active.id} />
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
                <p className="text-sm font-medium">Meta app</p>
                <p className="text-xs text-muted-foreground">
                  Real-time leads (webhook)
                </p>
                {metaApp.appId ? (
                  <Badge variant="secondary" className="mt-1">
                    {metaApp.appId} · {metaAppSecretPreview}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="mt-1">Not configured</Badge>
                )}
              </div>
              <form action={saveWorkspaceMetaApp} className="flex flex-1 flex-wrap items-center gap-2">
                <input type="hidden" name="workspaceId" value={active.id} />
                <Input
                  name="appId"
                  placeholder="App ID"
                  defaultValue={metaApp.appId ?? ""}
                  className="max-w-44"
                  required
                />
                <Input
                  name="appSecret"
                  type="password"
                  placeholder={metaAppSecretPreview ? "Replace app secret…" : "App secret"}
                  className="max-w-md"
                  required
                />
                <Button size="sm" type="submit">Save</Button>
              </form>
            </div>
          </CardContent>
        </Card>
      )}

      {active && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI API key · {active.name}
            </CardTitle>
            <CardDescription>
              Each client uses its own Anthropic API key (encrypted at rest) to
              power lead scoring and AI insights for {active.name}. When an
              agency-wide OpenAI key is set, bulk lead scoring runs on it
              (gpt-5-mini) instead.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
              <div className="min-w-44">
                <p className="text-sm font-medium">Anthropic API key</p>
                {aiPreview ? (
                  <Badge variant="secondary" className="mt-1">{aiPreview}</Badge>
                ) : (
                  <Badge variant="destructive" className="mt-1">Not configured</Badge>
                )}
              </div>
              <form action={saveWorkspaceAiKey} className="flex flex-1 items-center gap-2">
                <input type="hidden" name="workspaceId" value={active.id} />
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
            {platformAdmin && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
                <div className="min-w-44">
                  <p className="text-sm font-medium">OpenAI API key</p>
                  <p className="text-xs text-muted-foreground">Agency-wide</p>
                  {openaiPreview ? (
                    <Badge variant="secondary" className="mt-1">{openaiPreview}</Badge>
                  ) : (
                    <Badge variant="outline" className="mt-1">Not configured</Badge>
                  )}
                </div>
                <form action={savePlatformSecret} className="flex flex-1 items-center gap-2">
                  <input type="hidden" name="key" value="openai_api_key" />
                  <Input
                    name="value"
                    type="password"
                    placeholder={openaiPreview ? "Replace key…" : "sk-…"}
                    className="max-w-md"
                    required
                  />
                  <Button size="sm" type="submit">Save</Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Meta ad accounts</CardTitle>
          <CardDescription>
            Visible to {active?.name ?? "this client"}&apos;s Meta token. The ad
            account (and its Page, for leads) must be assigned to that token&apos;s
            system user.
          </CardDescription>
          {filtering && active && ready && (
            <p className="text-xs text-muted-foreground">
              Showing accounts for <span className="font-medium">{active.name}</span>{" "}
              and any unlinked account.
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {!ready && (
            <p className="text-sm text-muted-foreground">
              {active
                ? `Set ${active.name}'s Meta token above to list its ad accounts.`
                : "Select a client to manage its Meta connections."}
            </p>
          )}
          {accountsError && (
            <p className="text-sm text-destructive">
              Could not reach the Meta API: {accountsError}
            </p>
          )}
          {ready && !accountsError && displayAccounts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No ad accounts visible yet. Assign accounts to the system user in
              GoVivo&apos;s Business settings.
            </p>
          )}
          {ready && !accountsError && displayAccounts.length > 0 &&
            visibleAccounts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No ad accounts linked to {active?.name ?? "this client"} yet.
                Once this client&apos;s account is shared with the GoVivo system
                user it will appear here to connect.
              </p>
            )}

          {visibleAccounts.map((account) => {
            const conns = connectionsByAccount.get(account.externalId) ?? [];
            return (
              <div
                key={account.externalId}
                className="space-y-3 rounded-lg border p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{account.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {account.externalId}
                      {account.currency ? ` · ${account.currency}` : ""}
                    </p>
                  </div>
                  {account.live === false && (
                    <Badge variant="destructive" title="Re-share this ad account with the GoVivo system user in Meta Business Manager.">
                      Not visible in Meta — re-share to sync
                    </Badge>
                  )}
                  {conns.length === 0 && (
                    <Badge variant="secondary">Not linked</Badge>
                  )}
                </div>

                {/* An account is linked to exactly one client. Existing links
                    still render (so a wrong one can be disconnected here). */}
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
                      <SubmitButton
                        variant="outline"
                        pendingText="Syncing…"
                        icon={<RefreshCw className="mr-1 h-3.5 w-3.5" />}
                      >
                        Sync now
                      </SubmitButton>
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

                {/* Assign to a client — only while the account is unlinked.
                    To move it elsewhere, disconnect it first. */}
                {conns.length === 0 && account.live !== false && (
                  <form
                    action={connectMetaAccount}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="accountId" value={account.externalId} />
                    <input type="hidden" name="accountName" value={account.name} />
                    {filtering && active ? (
                      // A client is selected: connect straight to it, no picker.
                      <>
                        <input type="hidden" name="workspaceId" value={active.id} />
                        <SubmitButton pendingText="Connecting…">
                          Connect to {active.name}
                        </SubmitButton>
                      </>
                    ) : (
                      <>
                        <select
                          name="workspaceId"
                          required
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          defaultValue=""
                        >
                          <option value="" disabled>
                            Assign to workspace…
                          </option>
                          {workspaces.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </select>
                        <SubmitButton pendingText="Connecting…">
                          Connect
                        </SubmitButton>
                      </>
                    )}
                  </form>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {active && (
        <DispatchConnectionCard
          workspaceId={active.id}
          existing={dispatchConn}
        />
      )}

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
