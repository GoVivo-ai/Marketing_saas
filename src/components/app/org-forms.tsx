"use client";

import { useActionState, useState } from "react";
import {
  CircleCheck,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  createOrgUser,
  updateOrgUser,
  deleteOrgUser,
  resetOrgUserPassword,
  updateWorkspaceProfile,
  uploadWorkspaceLogo,
  removeWorkspaceLogo,
  type OrgActionState,
} from "@/lib/actions/org";
import { Button } from "@/components/ui/button";
import { CopySecret } from "@/components/app/copy-secret";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const initial: OrgActionState = {};

/** Per-company role picker (agent | supervisor | admin). */
function WsRoleSelect({
  id,
  defaultValue = "agent",
}: {
  id: string;
  defaultValue?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Role</Label>
      <select
        id={id}
        name="wsRole"
        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
        defaultValue={defaultValue}
      >
        <option value="agent">Agent (Leads, Contact Queue & Pipeline)</option>
        <option value="supervisor">Supervisor (full access)</option>
        <option value="admin">Admin (full access + team management)</option>
      </select>
    </div>
  );
}

function Feedback({ state }: { state: OrgActionState }) {
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

export function CreateOrgUserForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState(createOrgUser, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ou-name">Full name</Label>
          <Input id="ou-name" name="name" placeholder="Jane Pérez" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ou-email">Email</Label>
          <Input id="ou-email" name="email" type="email" placeholder="jane@company.com" required />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <WsRoleSelect id="ou-role" />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
        Add user
      </Button>
    </form>
  );
}

export function EditOrgUserDialog({
  workspaceId,
  userId,
  name,
  email,
  wsRole,
}: {
  workspaceId: string;
  userId: string;
  name: string;
  email: string;
  wsRole: string;
}) {
  const [state, action, pending] = useActionState(updateOrgUser, initial);
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Edit
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>Update this user&apos;s name or email.</DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-3">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="userId" value={userId} />
          <div className="space-y-2">
            <Label htmlFor={`edit-name-${userId}`}>Full name</Label>
            <Input id={`edit-name-${userId}`} name="name" defaultValue={name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`edit-email-${userId}`}>Email</Label>
            <Input id={`edit-email-${userId}`} name="email" type="email" defaultValue={email} required />
          </div>
          <WsRoleSelect id={`edit-role-${userId}`} defaultValue={wsRole} />
          <Feedback state={state} />
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="sm" type="button">Close</Button>} />
            <Button size="sm" type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteOrgUserButton({
  workspaceId,
  userId,
  name,
}: {
  workspaceId: string;
  userId: string;
  name: string;
}) {
  return (
    <form
      action={deleteOrgUser}
      onSubmit={(e) => {
        if (!confirm(`Remove ${name} from your organization?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="userId" value={userId} />
      <Button variant="ghost" size="sm" type="submit" className="text-destructive hover:text-destructive/80">
        <Trash2 className="mr-1 h-3.5 w-3.5" />
        Remove
      </Button>
    </form>
  );
}

export function ResetOrgPasswordButton({
  workspaceId,
  userId,
}: {
  workspaceId: string;
  userId: string;
}) {
  const [state, action, pending] = useActionState(resetOrgUserPassword, initial);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="workspaceId" value={workspaceId} />
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

export function CompanyProfileForm({
  workspaceId,
  name,
  industry,
  qualificationCriteria,
  resultLabel,
}: {
  workspaceId: string;
  name: string;
  industry: string;
  qualificationCriteria: string;
  resultLabel: string;
}) {
  const [state, action, pending] = useActionState(updateWorkspaceProfile, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cp-name">Company name</Label>
          <Input id="cp-name" name="name" defaultValue={name} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cp-industry">Industry</Label>
          <Input id="cp-industry" name="industry" defaultValue={industry} placeholder="Logistics" />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cp-result">Conversion goal name</Label>
        <Input
          id="cp-result"
          name="resultLabel"
          defaultValue={resultLabel}
          placeholder="Sales"
        />
        <p className="text-xs text-muted-foreground">
          What a closed result is called for this client (e.g. Sales, Hires,
          Appointments). Used across the Planner.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cp-criteria">Lead qualification criteria</Label>
        <textarea
          id="cp-criteria"
          name="qualificationCriteria"
          defaultValue={qualificationCriteria}
          rows={3}
          placeholder="What makes a good lead for your business (budget, location, role…). This guides the AI lead scoring."
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </div>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
        Save profile
      </Button>
    </form>
  );
}

/**
 * Brand logo uploader. The logo is rendered white next to the Vivo logo in the
 * sidebar, so the preview sits on a dark swatch to show how it will look.
 */
export function WorkspaceLogoForm({
  workspaceId,
  logoUrl,
}: {
  workspaceId: string;
  logoUrl: string | null;
}) {
  const [state, action, pending] = useActionState(uploadWorkspaceLogo, initial);
  const [removeState, removeAction, removing] = useActionState(
    removeWorkspaceLogo,
    initial,
  );
  const [preview, setPreview] = useState<string | null>(null);
  const shown = preview ?? logoUrl;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-32 shrink-0 items-center justify-center rounded-lg border bg-[#011640]">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shown}
              alt="Logo preview"
              className="h-9 w-auto max-w-[104px] object-contain"
              style={{ filter: "brightness(0) invert(1)" }}
            />
          ) : (
            <span className="text-xs text-muted-foreground">No logo</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Shown in white next to the Vivo logo. PNG, JPG, WEBP, GIF or SVG · max
          256 KB.
        </p>
      </div>

      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <Input
          type="file"
          name="logo"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
          className="max-w-xs"
        />
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Upload logo
        </Button>
        {logoUrl && (
          <Button
            type="submit"
            formAction={removeAction}
            variant="outline"
            disabled={removing}
          >
            {removing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Remove
          </Button>
        )}
      </form>
      <Feedback state={state.error || state.success ? state : removeState} />
    </div>
  );
}
