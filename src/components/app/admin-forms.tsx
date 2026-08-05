"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { CircleCheck, Loader2, RotateCcw, Trash2 } from "lucide-react";
import {
  createWorkspace,
  createUser,
  deleteWorkspace,
  deleteUser,
  resetUserPassword,
  setUserRole,
  type AdminActionState,
} from "@/lib/actions/admin";
import { Button } from "@/components/ui/button";
import { CopySecret } from "@/components/app/copy-secret";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: AdminActionState = {};

function Feedback({ state }: { state: AdminActionState }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (!state.success) return null;
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1 text-sm text-success">
        <CircleCheck className="h-4 w-4" />
        {state.success}
      </p>
      {state.tempPassword && <CopySecret value={state.tempPassword} />}
    </div>
  );
}

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspace, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="ws-name">Client name</Label>
          <Input id="ws-name" name="name" placeholder="Acme Corp" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ws-color">Brand color</Label>
          <Input id="ws-color" name="accentColor" type="color" defaultValue="#04d98b" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="ws-industry">Industry (optional)</Label>
        <Input id="ws-industry" name="industry" placeholder="Logistics" />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
        Create workspace
      </Button>
    </form>
  );
}

export function CreateUserForm({
  workspaces,
}: {
  workspaces: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createUser, initial);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="u-name">Full name</Label>
          <Input id="u-name" name="name" placeholder="Jane Pérez" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="u-email">Email</Label>
          <Input id="u-email" name="email" type="email" placeholder="jane@client.com" required />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="u-role">Role</Label>
          <select
            id="u-role"
            name="role"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            defaultValue="client"
          >
            <option value="client">Client (their workspace only)</option>
            <option value="agency_member">Agency member (Vivo agent — queue only)</option>
            <option value="agency_admin">Agency admin (full control)</option>
            <option value="developer">Developer (admin + dev dashboard)</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="u-workspace">Workspace (for client accounts)</Label>
          <select
            id="u-workspace"
            name="workspaceId"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            defaultValue=""
          >
            <option value="">—</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="u-ws-role">Company role (for client accounts)</Label>
          <select
            id="u-ws-role"
            name="wsRole"
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            defaultValue="agent"
          >
            <option value="agent">Agent (Leads, Contact Queue & Pipeline)</option>
            <option value="supervisor">Supervisor (full access)</option>
            <option value="admin">Admin (full access + team management)</option>
          </select>
          <p className="text-xs text-muted-foreground">
            The first user of a workspace always becomes its admin.
          </p>
        </div>
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
        Create account
      </Button>
    </form>
  );
}

export function DeleteWorkspaceButton({
  workspaceId,
  name,
}: {
  workspaceId: string;
  name: string;
}) {
  return (
    <form
      action={deleteWorkspace}
      onSubmit={(e) => {
        if (
          !confirm(
            `Delete "${name}" permanently?\n\nThis erases ALL its data: connections, campaigns, metrics and leads. This cannot be undone.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Button variant="ghost" size="sm" type="submit" className="text-destructive hover:text-destructive/80">
        <Trash2 className="mr-1 h-3.5 w-3.5" />
        Delete
      </Button>
    </form>
  );
}

/**
 * Inline platform-role editor for the Clients & Team roster. Saves on change;
 * the server enforces the guardrails (no self-change, developer-only grants)
 * and any rejection is surfaced as a toast with the value rolled back.
 */
export function UserRoleSelect({
  userId,
  role,
  options,
}: {
  userId: string;
  role: string;
  /** value/label pairs the current viewer is allowed to assign. */
  options: { value: string; label: string }[];
}) {
  const [value, setValue] = useState(role);
  const [pending, start] = useTransition();

  const onChange = (next: string) => {
    const prev = value;
    setValue(next);
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("userId", userId);
        fd.set("role", next);
        await setUserRole(fd);
        toast.success("Role updated.");
      } catch (err) {
        setValue(prev);
        toast.error(err instanceof Error ? err.message : "Couldn't change the role.");
      }
    });
  };

  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border bg-background px-1.5 text-xs"
      aria-label="Platform role"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function ResetPasswordButton({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(resetUserPassword, initial);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="userId" value={userId} />
      <Button variant="outline" size="sm" type="submit" disabled={pending}>
        {pending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
        )}
        Reset password
      </Button>
      {state.tempPassword && <CopySecret value={state.tempPassword} />}
      {state.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

export function DeleteUserButton({
  userId,
  name,
}: {
  userId: string;
  name: string;
}) {
  return (
    <form
      action={deleteUser}
      onSubmit={(e) => {
        if (
          !confirm(
            `Delete ${name}? This permanently removes their account and access.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <Button
        variant="ghost"
        size="sm"
        type="submit"
        className="text-destructive hover:text-destructive/80"
      >
        <Trash2 className="mr-1 h-3.5 w-3.5" />
        Delete
      </Button>
    </form>
  );
}
