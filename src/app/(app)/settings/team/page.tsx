import { formatDistanceToNow } from "date-fns";
import { eq } from "drizzle-orm";
import { Building2, UserPlus } from "lucide-react";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { setWorkspaceActive } from "@/lib/actions/admin";
import {
  CreateUserForm,
  CreateWorkspaceForm,
  ResetPasswordButton,
} from "@/components/app/admin-forms";
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

const roleLabel: Record<string, string> = {
  agency_admin: "Admin",
  agency_member: "Agency",
  client: "Client",
};

export default async function TeamPage() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;

  if (role !== "agency_admin") {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Clients & Team</h1>
        <p className="text-sm text-muted-foreground">
          Only agency admins can manage workspaces and user accounts.
        </p>
      </div>
    );
  }

  const [workspaces, users, memberships, activeConnections] = await Promise.all([
    db().select().from(schema.workspaces),
    db()
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        createdAt: schema.users.createdAt,
      })
      .from(schema.users),
    db()
      .select({
        userId: schema.workspaceMembers.userId,
        workspaceName: schema.workspaces.name,
      })
      .from(schema.workspaceMembers)
      .innerJoin(
        schema.workspaces,
        eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
      ),
    db()
      .select({ workspaceId: schema.connections.workspaceId })
      .from(schema.connections)
      .where(eq(schema.connections.status, "active")),
  ]);

  const connectedIds = new Set(activeConnections.map((c) => c.workspaceId));
  const workspacesByUser = new Map<string, string[]>();
  for (const m of memberships) {
    const list = workspacesByUser.get(m.userId) ?? [];
    list.push(m.workspaceName);
    workspacesByUser.set(m.userId, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clients & Team</h1>
        <p className="text-sm text-muted-foreground">
          Create a workspace per client, then create the user accounts that can
          access it. Temporary passwords are shown once — share them securely.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" />
              Client workspaces
            </CardTitle>
            <CardDescription>
              Each client of Vivo gets one workspace. Deactivating hides it
              everywhere without deleting its data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: ws.accentColor ?? "#6366f1" }}
                  />
                  <div>
                    <p className="text-sm font-medium">{ws.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ws.slug}
                      {ws.industry ? ` · ${ws.industry}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={connectedIds.has(ws.id) ? "default" : "secondary"}>
                    {connectedIds.has(ws.id) ? "Connected" : "Not connected"}
                  </Badge>
                  {!ws.isActive && <Badge variant="destructive">Inactive</Badge>}
                  <form action={setWorkspaceActive}>
                    <input type="hidden" name="workspaceId" value={ws.id} />
                    <input type="hidden" name="isActive" value={String(!ws.isActive)} />
                    <Button variant="ghost" size="sm" type="submit">
                      {ws.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </form>
                </div>
              </div>
            ))}

            <div className="border-t pt-4">
              <p className="mb-3 text-sm font-medium">New workspace</p>
              <CreateWorkspaceForm />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-4 w-4 text-primary" />
              User accounts
            </CardTitle>
            <CardDescription>
              Client users only see their assigned workspace. Agency accounts
              see every client.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{u.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {u.email} · added{" "}
                    {formatDistanceToNow(u.createdAt, { addSuffix: true })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={u.role === "client" ? "secondary" : "default"}>
                    {roleLabel[u.role] ?? u.role}
                  </Badge>
                  {u.role === "client" && (
                    <span className="text-xs text-muted-foreground">
                      {(workspacesByUser.get(u.id) ?? ["No workspace"]).join(", ")}
                    </span>
                  )}
                  <ResetPasswordButton userId={u.id} />
                </div>
              </div>
            ))}

            <div className="border-t pt-4">
              <p className="mb-3 text-sm font-medium">New account</p>
              <CreateUserForm
                workspaces={workspaces
                  .filter((w) => w.isActive)
                  .map((w) => ({ id: w.id, name: w.name }))}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
