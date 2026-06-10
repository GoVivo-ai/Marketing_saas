import Link from "next/link";
import { Suspense } from "react";
import { KeyRound, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import { getRingCentralTokens, isRingCentralConnected } from "@/lib/settings";
import { ChangePasswordForm } from "@/components/app/change-password-form";
import { RingCentralConnectCard } from "@/components/app/ringcentral-connect-card";
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Account security and workspace configuration
        </p>
      </div>

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
