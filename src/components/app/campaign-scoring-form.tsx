"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  BookmarkPlus,
  CircleCheck,
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
} from "lucide-react";
import {
  saveCampaignScoringCriteria,
  rescoreCampaign,
  type CampaignScoringState,
} from "@/lib/actions/campaigns";
import {
  savePromptTemplate,
  deletePromptTemplate,
} from "@/lib/actions/prompt-templates";
import type { CampaignFormField, PromptTemplate } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const initial: CampaignScoringState = {};

function Feedback({ state }: { state: CampaignScoringState }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (!state.success) return null;
  return (
    <p className="flex items-center gap-1 text-sm text-success">
      <CircleCheck className="h-4 w-4" />
      {state.success}
    </p>
  );
}

export function CampaignScoringForm({
  campaignId,
  workspaceId,
  scoringCriteria,
  formFields,
  templates = [],
}: {
  campaignId: string;
  workspaceId: string;
  scoringCriteria: string | null;
  formFields: CampaignFormField[];
  templates?: PromptTemplate[];
}) {
  const router = useRouter();
  const [criteria, setCriteria] = useState(scoringCriteria ?? "");
  const [saveState, saveAction, saving] = useActionState(
    saveCampaignScoringCriteria,
    initial,
  );
  const [rescoreState, rescoreAction, rescoring] = useActionState(
    rescoreCampaign,
    initial,
  );

  // Prompt templates: load one into the editor, save the editor as one.
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [savingTpl, startSaveTpl] = useTransition();
  const [deletingTpl, startDeleteTpl] = useTransition();
  const [tplError, setTplError] = useState<string | null>(null);
  const loaded = templates.find((t) => t.id === templateId) ?? null;

  const loadTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setTemplateId(id);
    setTemplateName(t.name);
    setCriteria(t.content);
    setTplError(null);
  };

  const saveTemplate = () =>
    startSaveTpl(async () => {
      const res = await savePromptTemplate(workspaceId, templateName, criteria);
      setTplError(res.ok ? null : res.error);
      if (res.ok) {
        setTemplateId(res.id);
        router.refresh();
      }
    });

  const deleteTemplate = () =>
    startDeleteTpl(async () => {
      if (!loaded) return;
      const res = await deletePromptTemplate(workspaceId, loaded.id);
      setTplError(res.ok ? null : res.error);
      if (res.ok) {
        setTemplateId("");
        setTemplateName("");
        router.refresh();
      }
    });

  // Append a field name to the prompt so the operator can reference it without
  // retyping the exact question the way the platform delivers it.
  const insertField = (key: string) =>
    setCriteria((c) => (c.trim() ? `${c.replace(/\s*$/, "")} ${key}` : key));

  return (
    <div className="space-y-4">
      {formFields.length > 0 && (
        <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Questions leads answer in this campaign
          </p>
          <p className="text-xs text-muted-foreground">
            Click a field to add it to your prompt. The AI sees these answers for
            every lead — reference them to define what a good lead looks like.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {formFields.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => insertField(f.key)}
                title={f.example ? `e.g. ${f.example}` : undefined}
                className="group inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
              >
                <Plus className="h-3 w-3 opacity-50 group-hover:opacity-100" />
                <span className="font-medium capitalize">
                  {f.label ?? f.key.replaceAll("_", " ")}
                </span>
                {f.example && (
                  <span className="max-w-[140px] truncate text-muted-foreground">
                    · {f.example}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Prompt templates — reuse a saved criteria prompt across campaigns. */}
      <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Prompt templates
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={templateId} onValueChange={(v) => v && loadTemplate(v)}>
            <SelectTrigger
              className="h-8 w-64 text-xs"
              aria-label="Load template"
            >
              {/* Render the name ourselves: right after saving, the fresh
                  template isn't in the list yet and the raw id (a UUID)
                  would show otherwise. */}
              <SelectValue placeholder="Load a template…">
                {templateId ? loaded?.name ?? templateName : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {templates.length === 0 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  No templates yet — write a prompt and save it below.
                </p>
              )}
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Template name…"
            className="h-8 w-52 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={savingTpl || !templateName.trim() || !criteria.trim()}
            onClick={saveTemplate}
          >
            {savingTpl ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <BookmarkPlus className="mr-1 h-3.5 w-3.5" />
            )}
            Save as template
          </Button>
          {loaded && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={deletingTpl}
              onClick={deleteTemplate}
              aria-label="Delete template"
            >
              {deletingTpl ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              )}
            </Button>
          )}
        </div>
        {loaded && (
          <p className="text-xs text-muted-foreground">
            Created by {loaded.createdBy ?? "unknown"} ·{" "}
            {format(loaded.createdAt, "PPp")}
            {loaded.updatedAt.getTime() !== loaded.createdAt.getTime() &&
              ` · updated ${format(loaded.updatedAt, "PPp")}`}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Loading a template replaces the prompt below (edit freely — the
          campaign only changes when you press Save criteria). Saving with an
          existing template&apos;s name updates that template.
        </p>
        {tplError && <p className="text-xs text-destructive">{tplError}</p>}
      </div>

      <form action={saveAction} className="space-y-3">
        <input type="hidden" name="campaignId" value={campaignId} />
        <div className="space-y-2">
          <Label htmlFor="scoring-criteria">Scoring criteria for this campaign</Label>
          <textarea
            id="scoring-criteria"
            name="scoringCriteria"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            rows={4}
            placeholder="What makes a good lead for THIS campaign (budget, location, intent, role…). This prompt guides the AI score for its leads. Leave empty to use the workspace-wide criteria."
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          />
          <p className="text-xs text-muted-foreground">
            Overrides the workspace criteria for this campaign&apos;s leads. New
            leads are scored with it automatically; existing leads keep their
            score until you re-score them.
          </p>
        </div>
        <Feedback state={saveState} />
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Save criteria
        </Button>
      </form>

      <form
        action={rescoreAction}
        className="flex flex-wrap items-center gap-3 border-t pt-4"
      >
        <input type="hidden" name="campaignId" value={campaignId} />
        <Button type="submit" variant="outline" disabled={rescoring}>
          {rescoring ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-1 h-4 w-4" />
          )}
          Re-score existing leads
        </Button>
        <p className="text-xs text-muted-foreground">
          Re-runs the AI score for every lead of this campaign using the saved
          criteria. Uses AI credits.
        </p>
        <div className="basis-full">
          <Feedback state={rescoreState} />
        </div>
      </form>
    </div>
  );
}
