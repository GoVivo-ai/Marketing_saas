import Link from "next/link";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { Building2, KeyRound, Users } from "lucide-react";
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
import { CompanyProfileForm } from "@/components/app/org-forms";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
  let company: { name: string; industry: string; criteria: string } | null = null;
  if (active && canManage) {
    const [w] = await db()
      .select({
        name: schema.workspaces.name,
        industry: schema.workspaces.industry,
        criteria: schema.workspaces.qualificationCriteria,
      })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, active.id))
      .limit(1);
    if (w)
      company = {
        name: w.name,
        industry: w.industry ?? "",
        criteria: w.criteria ?? "",
      };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Account security and workspace configuration
        </p>
      </div>

      {company && active && (
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
      )}

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
        <CardContent />
      </Card>
    </div>
  );
}
