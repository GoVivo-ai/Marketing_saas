"use client";

import { useActionState } from "react";
import { CircleCheck, Loader2, RefreshCw } from "lucide-react";
import {
  saveCampaignScoringCriteria,
  rescoreCampaign,
  type CampaignScoringState,
} from "@/lib/actions/campaigns";
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
}: {
  campaignId: string;
  scoringCriteria: string | null;
}) {
  const [saveState, saveAction, saving] = useActionState(
    saveCampaignScoringCriteria,
    initial,
  );
  const [rescoreState, rescoreAction, rescoring] = useActionState(
    rescoreCampaign,
    initial,
  );

  return (
    <div className="space-y-4">
      <form action={saveAction} className="space-y-3">
        <input type="hidden" name="campaignId" value={campaignId} />
        <div className="space-y-2">
          <Label htmlFor="scoring-criteria">Scoring criteria for this campaign</Label>
          <textarea
            id="scoring-criteria"
            name="scoringCriteria"
            defaultValue={scoringCriteria ?? ""}
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
