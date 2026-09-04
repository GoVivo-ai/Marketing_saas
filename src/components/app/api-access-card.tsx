"use client";

import { useActionState, useState } from "react";
import { format } from "date-fns";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plug,
  Unplug,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  createApiKey,
  revokeApiKey,
  disconnectApp,
  type ApiKeyActionState,
} from "@/lib/actions/api-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CopySecret } from "@/components/app/copy-secret";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface ConnectedApp {
  id: string;
  clientName: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date;
}

const initial: ApiKeyActionState = {};

const TOOLS = [
  "list_workspaces",
  "get_overview",
  "list_campaigns",
  "search_leads",
  "get_lead",
  "get_pipeline",
  "find_in_pipeline",
  "get_funnel_report",
  "get_agent_activity",
  "get_sync_status",
];

/**
 * Settings card: personal API keys for the read-only MCP server plus a
 * per-tool guide on how to connect. When a key was just created its value
 * is dropped straight into the snippets so the user can copy-paste once.
 */
export function ApiAccessCard({
  keys,
  apps,
  mcpUrl,
}: {
  keys: ApiKeySummary[];
  apps: ConnectedApp[];
  mcpUrl: string;
}) {
  const [state, action, pending] = useActionState(createApiKey, initial);
  const token = state.token ?? "<YOUR_API_KEY>";

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-primary" />
            Connected apps & API keys
          </CardTitle>
          <CardDescription>
            Everything that can query the platform as you — same workspaces,
            same permissions, read-only. Disconnect anything you don&apos;t
            recognize.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium">Connected apps</p>
            {apps.length > 0 ? (
              <ul className="divide-y rounded-md border">
                {apps.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{a.clientName}</p>
                      <p className="text-xs text-muted-foreground">
                        authorized {format(a.createdAt, "MMM d, yyyy")}
                        {a.lastUsedAt
                          ? ` · last used ${format(a.lastUsedAt, "MMM d, HH:mm")}`
                          : " · not used yet"}
                        {` · expires ${format(a.expiresAt, "MMM d")}`}
                      </p>
                    </div>
                    <form action={disconnectApp}>
                      <input type="hidden" name="id" value={a.id} />
                      <Button type="submit" variant="ghost" size="sm" aria-label={`Disconnect ${a.clientName}`}>
                        <Unplug className="h-3.5 w-3.5" />
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                No apps authorized yet. Apps you approve through the sign-in
                flow (Claude, ChatGPT, Claude Code…) appear here.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Personal API keys</p>
            <p className="text-xs text-muted-foreground">
              For tools that can&apos;t sign in with OAuth. Treat them like passwords.
            </p>
          {keys.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{k.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {k.keyPrefix}…{" "}
                      <span className="font-sans">
                        · created {format(k.createdAt, "MMM d, yyyy")}
                        {k.lastUsedAt
                          ? ` · last used ${format(k.lastUsedAt, "MMM d, HH:mm")}`
                          : " · never used"}
                      </span>
                    </p>
                  </div>
                  <form action={revokeApiKey}>
                    <input type="hidden" name="id" value={k.id} />
                    <Button type="submit" variant="ghost" size="sm" aria-label={`Revoke ${k.name}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active keys yet. Create one to connect an AI tool.
            </p>
          )}

          {state.token ? (
            <div className="space-y-2 rounded-md border border-success/40 bg-success/5 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-success" />
                Key &ldquo;{state.tokenName}&rdquo; created
              </p>
              <p className="text-xs text-muted-foreground">
                Copy it now — for security it is never shown again. The setup
                snippets on the right already include it.
              </p>
              <CopySecret value={state.token} />
            </div>
          ) : (
            <form action={action} className="flex flex-wrap items-end gap-2">
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="api-key-name">New key name</Label>
                <Input
                  id="api-key-name"
                  name="name"
                  placeholder='e.g. "Claude Code – laptop"'
                  maxLength={60}
                  required
                />
              </div>
              <Button type="submit" size="sm" disabled={pending}>
                {pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Create key
              </Button>
              {state.error && (
                <p className="basis-full text-sm text-destructive">{state.error}</p>
              )}
            </form>
          )}
          </div>

          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">What a connected tool can do</p>
            <p>
              Read campaigns, KPIs, leads, pipeline, funnel, agent activity and
              sync status. It cannot create, edit or delete anything.
            </p>
            <div className="flex flex-wrap gap-1 pt-1">
              {TOOLS.map((t) => (
                <Badge key={t} variant="outline" className="font-mono text-[11px]">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="h-4 w-4 text-primary" />
            Connect an AI tool
          </CardTitle>
          <CardDescription>
            The platform speaks MCP (Model Context Protocol) over HTTP with
            OAuth sign-in. Most tools only need the server URL: paste it, sign
            in with your Vivo account and approve. API keys are the fallback.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>Server URL</Label>
            <CodeBlock code={mcpUrl} />
          </div>
          <ConnectGuide mcpUrl={mcpUrl} token={token} />
        </CardContent>
      </Card>
    </div>
  );
}

function ConnectGuide({ mcpUrl, token }: { mcpUrl: string; token: string }) {
  const [tab, setTab] = useState("claude-code");
  const bearer = `Bearer ${token}`;

  const cursorJson = JSON.stringify(
    { mcpServers: { vivo: { url: mcpUrl, headers: { Authorization: bearer } } } },
    null,
    2,
  );
  const vscodeJson = JSON.stringify(
    { servers: { vivo: { type: "http", url: mcpUrl, headers: { Authorization: bearer } } } },
    null,
    2,
  );
  const desktopJson = JSON.stringify(
    {
      mcpServers: {
        vivo: {
          command: "npx",
          args: ["-y", "mcp-remote", mcpUrl, "--header", `Authorization:${bearer}`],
        },
      },
    },
    null,
    2,
  );
  const cursorOauthJson = JSON.stringify({ mcpServers: { vivo: { url: mcpUrl } } }, null, 2);
  const vscodeOauthJson = JSON.stringify(
    { servers: { vivo: { type: "http", url: mcpUrl } } },
    null,
    2,
  );
  const wellKnown = mcpUrl.replace(/\/api\/mcp$/, "") + "/.well-known";
  const geminiJson = JSON.stringify(
    { mcpServers: { vivo: { httpUrl: mcpUrl, headers: { Authorization: bearer } } } },
    null,
    2,
  );
  const curl = `curl -X POST ${mcpUrl} \\
  -H "Authorization: ${bearer}" \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
      <TabsList variant="line" className="h-auto flex-wrap">
        <TabsTrigger value="claude">Claude</TabsTrigger>
        <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
        <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
        <TabsTrigger value="cursor">Cursor</TabsTrigger>
        <TabsTrigger value="vscode">VS Code</TabsTrigger>
        <TabsTrigger value="other">Other</TabsTrigger>
      </TabsList>

      <TabsContent value="claude" className="space-y-2">
        <Steps
          steps={[
            "claude.ai (web) or Claude Desktop → Settings → Connectors → Add custom connector.",
            "Name it “Vivo” and paste the server URL above. Leave the OAuth client fields empty.",
            "Click Add, then Connect: sign in with your Vivo account and approve read-only access.",
            "In a chat, open the tools menu and enable Vivo. Ask e.g. “How many leads came in this week for Alexyah?”",
          ]}
        />
        <p className="text-xs text-muted-foreground">
          Requires a Claude plan with custom connectors. On Claude Desktop, the
          connector syncs from your claude.ai account; the JSON config below
          is only needed for older desktop versions.
        </p>
        <CodeBlock code={desktopJson} />
      </TabsContent>

      <TabsContent value="chatgpt" className="space-y-2">
        <Steps
          steps={[
            "ChatGPT → Settings → Connectors (Apps) → Create (Developer mode must be enabled by your workspace admin).",
            "Name it “Vivo”, paste the server URL above, choose Authentication: OAuth.",
            "Save, then Connect: sign in with your Vivo account and approve.",
            "Start a chat, pick Vivo under the tools menu, and ask about campaigns, leads or the pipeline.",
          ]}
        />
        <p className="text-xs text-muted-foreground">
          ChatGPT registers itself automatically (dynamic client registration);
          you never need to paste a client id or secret.
        </p>
      </TabsContent>

      <TabsContent value="claude-code" className="space-y-2">
        <Steps
          steps={[
            "Run the command below in a terminal (add --scope user to make it available in every project).",
            "Start claude and type /mcp → select vivo → Authenticate. A browser tab opens: sign in and approve.",
            "Ask e.g. “Which leads are stuck in New for more than 3 days?”",
          ]}
        />
        <CodeBlock code={`claude mcp add --transport http vivo ${mcpUrl}`} />
        <p className="text-xs text-muted-foreground">
          Headless or CI machines can&apos;t open a browser: use a personal API
          key instead.
        </p>
        <CodeBlock
          code={`claude mcp add --transport http vivo ${mcpUrl} \\\n  --header "Authorization: ${bearer}"`}
        />
      </TabsContent>

      <TabsContent value="cursor" className="space-y-2">
        <Steps
          steps={[
            "Cursor → Settings → MCP → Add new global MCP server (or create .cursor/mcp.json in a project).",
            "Paste the block below and save. Cursor asks you to sign in the first time it connects.",
            "Toggle the server on; the tools show up in Agent mode.",
          ]}
        />
        <CodeBlock code={cursorOauthJson} />
        <p className="text-xs text-muted-foreground">
          Prefer a key instead of signing in? Add the header:
        </p>
        <CodeBlock code={cursorJson} />
      </TabsContent>

      <TabsContent value="vscode" className="space-y-2">
        <Steps
          steps={[
            "Create .vscode/mcp.json in your workspace (or run MCP: Add Server from the command palette).",
            "Paste the block below and save. VS Code prompts you to sign in on first use.",
            "Open Copilot Chat in Agent mode and enable the vivo tools.",
          ]}
        />
        <CodeBlock code={vscodeOauthJson} />
        <p className="text-xs text-muted-foreground">Or with a personal key:</p>
        <CodeBlock code={vscodeJson} />
      </TabsContent>

      <TabsContent value="other" className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Any MCP client that supports Streamable HTTP works. Clients that
          implement MCP authorization discover the OAuth server automatically
          from the URL; the rest can send a personal key as a bearer token in
          the <code className="font-mono">Authorization</code> header.
        </p>
        <div className="space-y-1">
          <p className="text-xs font-medium">Gemini CLI / Windsurf-style config (API key)</p>
          <CodeBlock code={geminiJson} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium">Test from the terminal (API key)</p>
          <CodeBlock code={curl} />
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium">OAuth discovery documents</p>
          <CodeBlock code={`${wellKnown}/oauth-protected-resource\n${wellKnown}/oauth-authorization-server`} />
        </div>
      </TabsContent>
    </Tabs>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="list-decimal space-y-0.5 pl-4 text-sm">
      {steps.map((s) => (
        <li key={s}>{s}</li>
      ))}
    </ol>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the text below stays selectable.
    }
  };
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border bg-muted p-3 pr-20 font-mono text-xs leading-relaxed">
        {code}
      </pre>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={copy}
        className="absolute right-2 top-2 h-7"
      >
        {copied ? (
          <>
            <Check className="mr-1 h-3 w-3 text-success" /> Copied
          </>
        ) : (
          <>
            <Copy className="mr-1 h-3 w-3" /> Copy
          </>
        )}
      </Button>
    </div>
  );
}
