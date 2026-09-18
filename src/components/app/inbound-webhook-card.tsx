"use client";

import { useActionState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Webhook, RefreshCw, Trash2, Loader2, Hash } from "lucide-react";
import {
  generateInboundWebhook,
  saveInboundSlack,
  deleteInboundWebhook,
  type InboundWebhookState,
} from "@/lib/actions/inbound-webhooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopySecret } from "@/components/app/copy-secret";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const initial: InboundWebhookState = {};

/**
 * Settings card: the workspace's inbound lead webhook. An admin generates
 * the URL here and pastes it into the tool that sends leads — no developer
 * in the loop. Regenerating retires the old URL on the spot.
 */
export function InboundWebhookCard({
  workspaceId,
  workspaceName,
  url,
  slackWebhookUrl,
  receivedCount,
  lastReceivedAt,
}: {
  workspaceId: string;
  workspaceName: string;
  /** Full URL, or null when no webhook exists yet. */
  url: string | null;
  slackWebhookUrl: string | null;
  receivedCount: number;
  lastReceivedAt: string | null;
}) {
  const [gen, generate, generating] = useActionState(generateInboundWebhook, initial);
  const [slack, saveSlack, savingSlack] = useActionState(saveInboundSlack, initial);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="h-4 w-4 text-primary" />
          Incoming leads webhook · {workspaceName}
        </CardTitle>
        <CardDescription>
          A URL that turns anything posted to it into a lead for {workspaceName}:
          a website form, a hiring portal, Zapier. Generate it, copy it, paste
          it in the tool that sends the leads. Each new lead lands in the first
          pipeline stage and can be announced in Slack.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {url ? (
          <div className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Webhook URL</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Hash className="h-3.5 w-3.5" />
                {receivedCount === 0
                  ? "Nothing received yet"
                  : `${receivedCount} received${
                      lastReceivedAt
                        ? ` · last ${formatDistanceToNow(new Date(lastReceivedAt), { addSuffix: true })}`
                        : ""
                    }`}
              </div>
            </div>
            <CopySecret value={url} label="Webhook URL" className="w-full max-w-xl" />
            <div className="flex flex-wrap items-center gap-2">
              <form action={generate}>
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <Button type="submit" variant="outline" size="sm" disabled={generating}>
                  {generating ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  )}
                  Regenerate
                </Button>
              </form>
              <form action={deleteInboundWebhook}>
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Remove
                </Button>
              </form>
              <span className="text-xs text-muted-foreground">
                Regenerating or removing stops the old URL immediately.
              </span>
            </div>
            {gen.error && <p className="text-sm text-destructive">{gen.error}</p>}
            {gen.success && <p className="text-sm text-success">{gen.success}</p>}
          </div>
        ) : (
          <form action={generate} className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <div className="min-w-44 flex-1">
              <p className="text-sm font-medium">Webhook URL</p>
              <Badge variant="secondary" className="mt-1">Not generated</Badge>
            </div>
            <Button type="submit" size="sm" disabled={generating}>
              {generating ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Webhook className="mr-1 h-3.5 w-3.5" />
              )}
              Generate URL
            </Button>
            {gen.error && <p className="w-full text-sm text-destructive">{gen.error}</p>}
          </form>
        )}

        {url && (
          <form action={saveSlack} className="space-y-2 rounded-lg border p-4">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Slack notifications</p>
              {slackWebhookUrl ? (
                <Badge variant="secondary">On</Badge>
              ) : (
                <Badge variant="outline">Off</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              In Slack: Apps → Incoming Webhooks → pick the channel → copy the
              URL here. Leave empty to turn notifications off.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                name="slackWebhookUrl"
                defaultValue={slackWebhookUrl ?? ""}
                placeholder="https://hooks.slack.com/services/…"
                className="max-w-xl flex-1 font-mono text-xs"
              />
              <Button type="submit" size="sm" variant="outline" disabled={savingSlack}>
                {savingSlack && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Save
              </Button>
            </div>
            {slack.error && <p className="text-sm text-destructive">{slack.error}</p>}
            {slack.success && <p className="text-sm text-success">{slack.success}</p>}
          </form>
        )}

        <details className="rounded-lg border p-4 text-sm">
          <summary className="cursor-pointer font-medium">What to send</summary>
          <div className="mt-3 space-y-2 text-muted-foreground">
            <p>
              POST a JSON object. These fields fill the lead: <code>first_name</code>,{" "}
              <code>last_name</code> (or <code>name</code>), <code>email</code>,{" "}
              <code>phone</code>, <code>city</code>, <code>state</code>, and{" "}
              <code>id</code> to avoid duplicates on retries. Any other field is
              kept as a form answer on the lead — links (a resume, a LinkedIn
              profile) become clickable.
            </p>
            <p>
              An envelope <code>{"{ \"event\": \"application.created\", \"data\": { … } }"}</code>{" "}
              works too; other events are acknowledged and ignored.
            </p>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">
{`curl -X POST ${url ?? "<webhook url>"} \\
  -H "Content-Type: application/json" \\
  -d '{"id":"123","first_name":"Ana","last_name":"Ruiz","email":"ana@example.com","phone":"+13055550100","role":"Sales Representative"}'`}
            </pre>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
