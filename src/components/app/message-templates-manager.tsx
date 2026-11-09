"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2, MessageSquare, Mail } from "lucide-react";
import {
  deleteMessageTemplate,
  saveMessageTemplate,
  type MessageTemplate,
} from "@/lib/actions/message-templates";
import {
  renderTemplate,
  smsSegments,
  SAMPLE_VARS,
  TEMPLATE_PLACEHOLDERS,
  TEMPLATE_CHANNEL_LABEL,
  type TemplateChannel,
} from "@/lib/message-templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const TEXTAREA =
  "w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 font-mono";

type Draft = {
  id: string | null;
  channel: TemplateChannel;
  name: string;
  subject: string;
  body: string;
  sortOrder: number;
};

const blank = (channel: TemplateChannel): Draft => ({
  id: null,
  channel,
  name: "",
  subject: "",
  body: "",
  sortOrder: 0,
});

/** Settings → Templates: the workspace's SMS and email texts, with live preview. */
export function MessageTemplatesManager({
  workspaceId,
  templates,
}: {
  workspaceId: string;
  templates: MessageTemplate[];
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const byChannel = useMemo(
    () => ({
      sms: templates.filter((t) => t.channel === "sms"),
      email: templates.filter((t) => t.channel === "email"),
    }),
    [templates],
  );

  return (
    <div className="space-y-4">
      {(["sms", "email"] as const).map((ch) => (
        <Card key={ch}>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                {ch === "sms" ? (
                  <MessageSquare className="h-4 w-4 text-primary" />
                ) : (
                  <Mail className="h-4 w-4 text-primary" />
                )}
                {TEMPLATE_CHANNEL_LABEL[ch]} templates
              </CardTitle>
              <CardDescription>
                {ch === "sms"
                  ? "What agents pick in the SMS composer. Keep an eye on the segment count."
                  : "Subject and body for the Email composer. Plain text; the agent's mailbox sends it."}
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setDraft(blank(ch))}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              New
            </Button>
          </CardHeader>
          <CardContent>
            {byChannel[ch].length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No {TEMPLATE_CHANNEL_LABEL[ch]} templates yet.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {byChannel[ch].map((t) => (
                  <TemplateRow
                    key={t.id}
                    workspaceId={workspaceId}
                    template={t}
                    onEdit={() =>
                      setDraft({
                        id: t.id,
                        channel: t.channel,
                        name: t.name,
                        subject: t.subject ?? "",
                        body: t.body,
                        sortOrder: t.sortOrder,
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}

      <Dialog open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {draft && (
            <TemplateEditor
              workspaceId={workspaceId}
              draft={draft}
              onChange={setDraft}
              onClose={() => setDraft(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateRow({
  workspaceId,
  template: t,
  onEdit,
}: {
  workspaceId: string;
  template: MessageTemplate;
  onEdit: () => void;
}) {
  const [deleting, startDelete] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const seg = t.channel === "sms" ? smsSegments(renderTemplate(t.body, SAMPLE_VARS)) : null;

  const remove = () =>
    startDelete(async () => {
      const r = await deleteMessageTemplate(workspaceId, t.id);
      if (!r.ok) toast.error(r.error);
      else toast.success(`Deleted "${t.name}".`);
      setConfirm(false);
    });

  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-medium">
          {t.name}
          {seg && (
            <Badge variant="outline" className="font-normal">
              ~{seg.segments} SMS
            </Badge>
          )}
        </p>
        {t.subject && <p className="truncate text-xs text-muted-foreground">{t.subject}</p>}
        <p className="line-clamp-2 text-xs text-muted-foreground">{t.body}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" onClick={onEdit} title="Edit">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        {confirm ? (
          <>
            <Button variant="destructive" size="sm" disabled={deleting} onClick={remove}>
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Delete"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} title="Delete">
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        )}
      </div>
    </li>
  );
}

function TemplateEditor({
  workspaceId,
  draft,
  onChange,
  onClose,
}: {
  workspaceId: string;
  draft: Draft;
  onChange: (d: Draft) => void;
  onClose: () => void;
}) {
  const [saving, startSave] = useTransition();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v });

  const preview = renderTemplate(draft.body, SAMPLE_VARS);
  const previewSubject = draft.subject ? renderTemplate(draft.subject, SAMPLE_VARS) : "";
  const seg = smsSegments(preview);

  const save = () =>
    startSave(async () => {
      const r = await saveMessageTemplate(workspaceId, {
        id: draft.id,
        channel: draft.channel,
        name: draft.name,
        subject: draft.subject,
        body: draft.body,
        sortOrder: draft.sortOrder,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(draft.id ? "Template updated." : "Template created.");
      onClose();
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {draft.id ? "Edit" : "New"} {TEMPLATE_CHANNEL_LABEL[draft.channel]} template
        </DialogTitle>
        <DialogDescription>
          Placeholders are filled with the lead&apos;s and the agent&apos;s data when
          the template is picked. The preview on the right uses sample values.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 md:grid-cols-[1fr_minmax(0,18rem)]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
            <div className="space-y-1.5">
              <Label htmlFor="mt-name">Name</Label>
              <Input
                id="mt-name"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={draft.channel === "sms" ? "Follow-up" : "Job offer"}
                maxLength={80}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mt-order">Order</Label>
              <Input
                id="mt-order"
                type="number"
                value={draft.sortOrder}
                onChange={(e) => set("sortOrder", Number(e.target.value) || 0)}
              />
            </div>
          </div>
          {draft.channel === "email" && (
            <div className="space-y-1.5">
              <Label htmlFor="mt-subject">Subject</Label>
              <Input
                id="mt-subject"
                value={draft.subject}
                onChange={(e) => set("subject", e.target.value)}
                placeholder="Earn $1,200 - $2,400*/month driving in {city}"
                maxLength={200}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="mt-body">Message</Label>
            <textarea
              id="mt-body"
              value={draft.body}
              onChange={(e) => set("body", e.target.value)}
              rows={draft.channel === "sms" ? 8 : 16}
              maxLength={10_000}
              className={TEXTAREA}
              placeholder={
                draft.channel === "sms"
                  ? "Hi {first_name}! This is {agent_name} from …"
                  : "Hi {first_name},\n\n…\n\nBest regards,\n{agent_name}"
              }
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_PLACEHOLDERS.map((p) => (
              <button
                key={p.token}
                type="button"
                title={p.hint}
                onClick={() => set("body", draft.body + (draft.body && !draft.body.endsWith(" ") ? " " : "") + p.token)}
                className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted"
              >
                {p.token}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Preview
          </p>
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            {previewSubject && <p className="mb-2 font-medium">{previewSubject}</p>}
            <p className="whitespace-pre-wrap">{preview || <span className="text-muted-foreground">Nothing yet.</span>}</p>
          </div>
          {draft.channel === "sms" && (
            <p
              className={cn(
                "text-xs text-muted-foreground",
                seg.segments > 3 && "text-amber-600 dark:text-amber-400",
              )}
            >
              {seg.chars} chars · ~{seg.segments} SMS
              {seg.unicode ? " · special characters shrink each segment to 70" : ""}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Sample: {SAMPLE_VARS.name} in {SAMPLE_VARS.city}, from {SAMPLE_VARS.agentName}.
          </p>
        </div>
      </div>

      <DialogFooter>
        <DialogClose
          render={
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          }
        />
        <Button size="sm" disabled={saving || !draft.name.trim() || !draft.body.trim()} onClick={save}>
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {draft.id ? "Save changes" : "Create template"}
        </Button>
      </DialogFooter>
    </>
  );
}
