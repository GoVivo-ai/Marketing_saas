import Link from "next/link";
import { Suspense } from "react";
import { and, eq, isNotNull, ne, or } from "drizzle-orm";
import { Building2, KeyRound, Users, ImageIcon, Phone, Zap } from "lucide-react";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/data";
import { canManageWorkspace } from "@/lib/permissions";
import {
  getDialpadTokens,
  isDialpadConnected,
  getRingCentralTokens,
  isRingCentralConnected,
  getRingCentralEnv,
} from "@/lib/settings";
import { isRingCentralConfigured } from "@/lib/integrations/ringcentral";
import { currentUser, isAgentOnly } from "@/lib/permissions";
import { RingCentralConnectCard } from "@/components/app/ringcentral-connect-card";
import {
  getScoreAutomation,
  getScoreAutomationUsage,
  type ScoreAutomationUsage,
} from "@/lib/automations";
import { ChangePasswordForm } from "@/components/app/change-password-form";
import { ApiAccessCard } from "@/components/app/api-access-card";
import { listApiKeys } from "@/lib/api-keys";
import { listConnectedApps } from "@/lib/oauth";
import { isDemoEmail } from "@/lib/demo";
import { headers } from "next/headers";
import { DialpadConnectCard } from "@/components/app/dialpad-connect-card";
import { CompanyProfileForm, WorkspaceLogoForm } from "@/components/app/org-forms";
import {
  ScoreAutomationForm,
  type SenderOption,
} from "@/components/app/score-automation-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/** Public URL of the MCP endpoint, from env or the current request's host. */
async function mcpEndpointUrl() {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (base) return `${base}/api/mcp`;
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${h.get("host") ?? "localhost:3000"}/api/mcp`;
}

export default async function GeneralSettingsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  // The demo tour user never gets API keys (the workspace is anonymized data).
  const showApiAccess = Boolean(userId) && !isDemoEmail(session?.user?.email);
  const [apiKeys, connectedApps, mcpUrl] = await Promise.all([
    showApiAccess && userId ? listApiKeys(userId) : Promise.resolve([]),
    showApiAccess && userId ? listConnectedApps(userId) : Promise.resolve([]),
    mcpEndpointUrl(),
  ]);

  // Agents manage their own password and their own RingCentral connection —
  // never workspace configuration. The personal RC link is what lets the
  // platform mirror their call log into the Agent Activity report.
  if (await isAgentOnly()) {
    const agentRcConnected = userId
      ? await isRingCentralConnected(userId)
      : false;
    const agentRcTokens =
      userId && agentRcConnected ? await getRingCentralTokens(userId) : null;
    const [agentRcEnv, agentRcEnvConfigured] = await Promise.all([
      getRingCentralEnv(),
      isRingCentralConfigured(),
    ]);
    return (
      <div className="space-y-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Account security & calling
          </p>
        </div>
        <div className="grid max-w-4xl gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4 text-primary" />
                Change password
              </CardTitle>
              <CardDescription>
                Signed in as {session?.user?.email}. Choose a strong password
                you don&apos;t use anywhere else.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>
          <Suspense>
            <RingCentralConnectCard
              connected={agentRcConnected}
              fromNumber={agentRcTokens?.fromNumber ?? null}
              env={agentRcEnv}
              envConfigured={agentRcEnvConfigured}
            />
          </Suspense>
        </div>
        {showApiAccess && (
          <section className="space-y-3">
            <SectionHeading
              title="API access"
              description="Connect Claude, ChatGPT, Cursor or other AI tools to query your leads and pipeline (read-only)."
            />
            <ApiAccessCard keys={apiKeys} apps={connectedApps} mcpUrl={mcpUrl} />
          </section>
        )}
      </div>
    );
  }

  const dpConnected = userId ? await isDialpadConnected(userId) : false;
  const dpTokens = userId && dpConnected ? await getDialpadTokens(userId) : null;

  // Server-side RingCentral connection (REST API): powers click-to-call/SMS
  // actions and the score automation's automated sends.
  const rcConnected = userId ? await isRingCentralConnected(userId) : false;
  const rcTokens = userId && rcConnected ? await getRingCentralTokens(userId) : null;
  const [rcEnv, rcEnvConfigured, me] = await Promise.all([
    getRingCentralEnv(),
    isRingCentralConfigured(),
    currentUser(),
  ]);

  const { active } = await getWorkspaceContext();
  const canManage = active ? await canManageWorkspace(active.id) : false;
  let company:
    | {
        name: string;
        industry: string;
        criteria: string;
        logoUrl: string | null;
        resultLabel: string;
      }
    | null = null;
  let automationRule: Awaited<ReturnType<typeof getScoreAutomation>> = null;
  let automationUsage: ScoreAutomationUsage | null = null;
  let senders: SenderOption[] = [];
  if (active && canManage) {
    // Score-automation rule + who can be the automated-SMS sender: agency
    // users and this workspace's members, flagging telephony connection.
    [automationRule, automationUsage] = await Promise.all([
      getScoreAutomation(active.id),
      getScoreAutomationUsage(active.id),
    ]);
    const senderRows = await db()
      .selectDistinctOn([schema.users.id], {
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        rcConnectedAt: schema.users.rcConnectedAt,
        dpConnectedAt: schema.users.dpConnectedAt,
      })
      .from(schema.users)
      .leftJoin(
        schema.workspaceMembers,
        and(
          eq(schema.workspaceMembers.userId, schema.users.id),
          eq(schema.workspaceMembers.workspaceId, active.id),
        ),
      )
      .where(
        or(
          ne(schema.users.role, "client"),
          isNotNull(schema.workspaceMembers.id),
        ),
      );
    senders = senderRows
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        telephonyConnected: u.rcConnectedAt != null || u.dpConnectedAt != null,
      }))
      .sort(
        (a, b) =>
          Number(b.telephonyConnected) - Number(a.telephonyConnected) ||
          a.name.localeCompare(b.name),
      );
  }
  if (active && canManage) {
    const [w] = await db()
      .select({
        name: schema.workspaces.name,
        industry: schema.workspaces.industry,
        criteria: schema.workspaces.qualificationCriteria,
        logoUrl: schema.workspaces.logoUrl,
        resultLabel: schema.workspaces.resultLabel,
      })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, active.id))
      .limit(1);
    if (w)
      company = {
        name: w.name,
        industry: w.industry ?? "",
        criteria: w.criteria ?? "",
        logoUrl: w.logoUrl ?? null,
        resultLabel: w.resultLabel ?? "Sales",
      };
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Account security and workspace configuration
        </p>
      </div>

      {company && active && (
        <section className="space-y-3">
          <SectionHeading
            title="Workspace"
            description={`Profile and lead-scoring criteria for ${active.name}.`}
          />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4 text-primary" />
                Company profile · {active.name}
              </CardTitle>
              <CardDescription>
                Your company details and the lead qualification criteria that
                guides AI lead scoring.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CompanyProfileForm
                workspaceId={active.id}
                name={company.name}
                industry={company.industry}
                qualificationCriteria={company.criteria}
                resultLabel={company.resultLabel}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-4 w-4 text-primary" />
                Score automation
              </CardTitle>
              <CardDescription>
                Contact leads automatically based on their AI score: send an
                SMS the moment a lead is scored, or flag it in the Contact
                Queue with a ready-made script for the agent.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {automationUsage && automationUsage.total > 0 && (
                <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Usage
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold">{automationUsage.total}</span>{" "}
                    leads auto-contacted ·{" "}
                    <span className="font-semibold">
                      {automationUsage.last30Days}
                    </span>{" "}
                    in the last 30 days
                  </p>
                  <ul className="space-y-1 text-sm">
                    {automationUsage.recent.map((l) => (
                      <li
                        key={l.id}
                        className="flex items-center justify-between gap-3"
                      >
                        <Link
                          href={`/leads?lead=${l.id}`}
                          className="min-w-0 truncate hover:text-primary hover:underline"
                        >
                          {l.name ?? "Unknown"}
                          {l.aiScore != null && (
                            <span className="text-muted-foreground">
                              {" "}
                              · score {l.aiScore}
                            </span>
                          )}
                        </Link>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {l.autoContactedAt.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Each send is also logged on the lead&apos;s activity
                    timeline, marked as automated.
                  </p>
                </div>
              )}
              <ScoreAutomationForm
                workspaceId={active.id}
                rule={
                  automationRule ?? {
                    enabled: false,
                    direction: "above",
                    threshold: 70,
                    action: "sms",
                    message: "",
                    senderUserId: null,
                  }
                }
                senders={senders}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="h-4 w-4 text-primary" />
                Brand logo
              </CardTitle>
              <CardDescription>
                Upload {active.name}&apos;s logo — it appears next to the Vivo
                logo while this client is active.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WorkspaceLogoForm
                workspaceId={active.id}
                logoUrl={company.logoUrl}
              />
            </CardContent>
          </Card>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeading
          title="Calling & messaging"
          description="Call and text leads straight from the pipeline. RingCentral runs in the in-app dialer; Dialpad is available as an alternative."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Suspense>
            <RingCentralConnectCard
              connected={rcConnected}
              fromNumber={rcTokens?.fromNumber ?? null}
              isAdmin={me?.role === "agency_admin" || me?.role === "developer"}
              env={rcEnv}
              envConfigured={rcEnvConfigured}
            />
          </Suspense>
          <Suspense>
            <DialpadConnectCard
              connected={dpConnected}
              fromNumber={dpTokens?.fromNumber ?? null}
            />
          </Suspense>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Phone className="h-4 w-4 text-primary" />
              In-app dialer (RingCentral Embeddable)
            </CardTitle>
            <CardDescription>
              Independently of the connection above, the in-app dialer at the
              bottom-right of any page lets agents call/SMS through the
              browser — sign in once with your RingCentral account inside the
              widget. The connection above is what powers automated SMS and
              server-side click-to-call.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeading
          title="Account & access"
          description="Your sign-in security and where the team is managed."
        />
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4 text-primary" />
                Change password
              </CardTitle>
              <CardDescription>
                Signed in as {session?.user?.email}. Choose a strong password you
                don&apos;t use anywhere else.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-primary" />
                Team & permissions
              </CardTitle>
              <CardDescription>
                Workspaces and user accounts are managed in{" "}
                <Link href="/settings/team" className="text-primary underline">
                  Clients &amp; Team
                </Link>
                . Client users only see their own workspace; the agency sees
                everything.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                size="sm"
                render={<Link href="/settings/team" />}
              >
                <Users className="mr-1 h-3.5 w-3.5" />
                Manage team
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {showApiAccess && (
        <section className="space-y-3">
          <SectionHeading
            title="API access"
            description="Connect Claude, ChatGPT, Claude Code, Cursor or any MCP client to query campaigns, leads and reports (read-only)."
          />
          <ApiAccessCard keys={apiKeys} apps={connectedApps} mcpUrl={mcpUrl} />
        </section>
      )}
    </div>
  );
}

/** Small section label + helper text used to group the settings cards. */
function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-0.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
