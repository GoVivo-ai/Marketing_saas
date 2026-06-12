import Link from "next/link";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { Building2, KeyRound, Users, ImageIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/data";
import { canManageWorkspace } from "@/lib/permissions";
import {
  getRingCentralTokens,
  isRingCentralConnected,
  getDialpadTokens,
  isDialpadConnected,
} from "@/lib/settings";
import { ChangePasswordForm } from "@/components/app/change-password-form";
import { RingCentralConnectCard } from "@/components/app/ringcentral-connect-card";
import { DialpadConnectCard } from "@/components/app/dialpad-connect-card";
import { CompanyProfileForm, WorkspaceLogoForm } from "@/components/app/org-forms";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function GeneralSettingsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  const rcConnected = userId ? await isRingCentralConnected(userId) : false;
  const rcTokens =
    userId && rcConnected ? await getRingCentralTokens(userId) : null;
  const dpConnected = userId ? await isDialpadConnected(userId) : false;
  const dpTokens = userId && dpConnected ? await getDialpadTokens(userId) : null;

  const { active } = await getWorkspaceContext();
  const canManage = active ? await canManageWorkspace(active.id) : false;
  let company:
    | { name: string; industry: string; criteria: string; logoUrl: string | null }
    | null = null;
  if (active && canManage) {
    const [w] = await db()
      .select({
        name: schema.workspaces.name,
        industry: schema.workspaces.industry,
        criteria: schema.workspaces.qualificationCriteria,
        logoUrl: schema.workspaces.logoUrl,
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
          description="Connect a provider to call and text leads from the pipeline. Connect either one — if you connect both, the most recently connected is used."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Suspense>
            <RingCentralConnectCard
              connected={rcConnected}
              fromNumber={rcTokens?.fromNumber ?? null}
            />
          </Suspense>
          <Suspense>
            <DialpadConnectCard
              connected={dpConnected}
              fromNumber={dpTokens?.fromNumber ?? null}
            />
          </Suspense>
        </div>
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
