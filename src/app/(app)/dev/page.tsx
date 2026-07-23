import { redirect } from "next/navigation";
import { format } from "date-fns";
import { count, sql } from "drizzle-orm";
import {
  Activity,
  Building2,
  Database,
  Inbox,
  KeyRound,
  TerminalSquare,
  Users,
} from "lucide-react";
import { googleSsoEnabled } from "@/lib/auth";
import { currentUser } from "@/lib/permissions";
import { db, schema, isDatabaseConfigured } from "@/lib/db";
import { getMaintenance, getSecretPreview } from "@/lib/settings";
import { DevMaintenanceForm } from "@/components/app/dev-maintenance-form";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

function StatusBadge({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span
        className={
          ok ? "h-1.5 w-1.5 rounded-full bg-success" : "h-1.5 w-1.5 rounded-full bg-destructive"
        }
      />
      {ok ? on : off}
    </Badge>
  );
}

export default async function DevDashboardPage() {
  const me = await currentUser();
  if (me?.role !== "developer") redirect("/dashboard");

  const dbReady = isDatabaseConfigured();

  const [maintenance, anthropicKey, metaToken, stats] = await Promise.all([
    getMaintenance(),
    getSecretPreview("anthropic_api_key"),
    getSecretPreview("meta_access_token"),
    dbReady
      ? Promise.all([
          db().select({ n: count() }).from(schema.users),
          db().select({ n: count() }).from(schema.workspaces),
          db().select({ n: count() }).from(schema.leads),
          db()
            .select({ n: count() })
            .from(schema.leadEvents)
            .where(sql`${schema.leadEvents.createdAt} >= now() - interval '24 hours'`),
        ])
      : null,
  ]);

  const [users, workspaces, leads, touches24h] = stats?.map((r) => r[0]?.n ?? 0) ?? [];

  const statCards = [
    { label: "Users", value: users, icon: Users },
    { label: "Workspaces", value: workspaces, icon: Building2 },
    { label: "Leads", value: leads, icon: Inbox },
    { label: "Events (24h)", value: touches24h, icon: Activity },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <TerminalSquare className="h-6 w-6 text-primary" />
          Developer
        </h1>
        <p className="text-sm text-muted-foreground">
          Platform status and operations. Only developer accounts see this page.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <s.icon className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-lg font-semibold">
                  {dbReady ? s.value : "—"}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Maintenance</CardTitle>
          <CardDescription>
            {maintenance.active
              ? `ON since ${
                  maintenance.updatedAt
                    ? format(new Date(maintenance.updatedAt), "PPp")
                    : "unknown"
                }${maintenance.updatedBy ? ` — by ${maintenance.updatedBy}` : ""}`
              : maintenance.upcoming
                ? "A maintenance window is scheduled."
                : "The platform is running normally."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DevMaintenanceForm
            enabled={maintenance.enabled}
            message={maintenance.message}
            scheduledStart={maintenance.scheduledStart}
            scheduledEnd={maintenance.scheduledEnd}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">System</CardTitle>
          <CardDescription>
            Environment and platform-level integrations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            <li className="flex items-center justify-between py-2.5">
              <span className="flex items-center gap-2">
                <TerminalSquare className="h-4 w-4 text-muted-foreground" />
                Environment
              </span>
              <Badge variant="outline" className="font-normal">
                {process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown"}
              </Badge>
            </li>
            <li className="flex items-center justify-between py-2.5">
              <span className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                Database
              </span>
              <StatusBadge ok={dbReady} on="Connected" off="Not configured" />
            </li>
            <li className="flex items-center justify-between py-2.5">
              <span className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                Google SSO
              </span>
              <StatusBadge ok={googleSsoEnabled} on="Enabled" off="Disabled" />
            </li>
            <li className="flex items-center justify-between py-2.5">
              <span className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                Anthropic key (agency)
              </span>
              <StatusBadge ok={Boolean(anthropicKey)} on={anthropicKey ?? "Set"} off="Missing" />
            </li>
            <li className="flex items-center justify-between py-2.5">
              <span className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                Meta access token (agency)
              </span>
              <StatusBadge ok={Boolean(metaToken)} on={metaToken ?? "Set"} off="Missing" />
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
