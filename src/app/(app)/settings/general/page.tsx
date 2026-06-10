import { KeyRound, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/app/change-password-form";
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-primary" />
            Team & permissions
          </CardTitle>
          <CardDescription>
            Invite Vivo team members and client users. Clients only see their
            own workspace; the agency sees everything. Coming next.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
