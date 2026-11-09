import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getWorkspaceContext } from "@/lib/data";
import { canManageWorkspace } from "@/lib/permissions";
import { listAllMessageTemplates } from "@/lib/actions/message-templates";
import { MessageTemplatesManager } from "@/components/app/message-templates-manager";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/** Settings → Templates: SMS and email texts agents pick from the queue. */
export default async function TemplatesSettingsPage() {
  const { active } = await getWorkspaceContext();
  const canManage = active ? await canManageWorkspace(active.id) : false;

  if (!active || !canManage) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Message templates</h1>
        <p className="text-sm text-muted-foreground">
          Only supervisors and admins can edit the workspace&apos;s templates.
          Agents pick them from the SMS and Email composers.
        </p>
      </div>
    );
  }

  const templates = await listAllMessageTemplates(active.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Message templates</h1>
          <p className="text-sm text-muted-foreground">
            SMS and email texts for {active.name}. Agents pick one in the Contact
            Queue or on a lead; placeholders fill in with the lead&apos;s city and
            the agent&apos;s own name and number.
          </p>
        </div>
        <Button variant="ghost" size="sm" render={<Link href="/settings/general" />}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          Settings
        </Button>
      </div>
      <MessageTemplatesManager workspaceId={active.id} templates={templates} />
    </div>
  );
}
