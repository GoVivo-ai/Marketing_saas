"use client";

import { useActionState, useState } from "react";
import { CircleCheck, Loader2, RefreshCw, Plus } from "lucide-react";
import {
  saveCampaignScoringCriteria,
  rescoreCampaign,
  type CampaignScoringState,
} from "@/lib/actions/campaigns";
import type { CampaignFormField } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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
  scoringCriteria,
  formFields,
}: {
  campaignId: string;
  scoringCriteria: string | null;
  formFields: CampaignFormField[];
}) {
  const [criteria, setCriteria] = useState(scoringCriteria ?? "");
  const [saveState, saveAction, saving] = useActionState(
    saveCampaignScoringCriteria,
    initial,
  );
  const [rescoreState, rescoreAction, rescoring] = useActionState(
    rescoreCampaign,
    initial,
  );

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
