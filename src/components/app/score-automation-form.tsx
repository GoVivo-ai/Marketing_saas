"use client";

import { useActionState, useState } from "react";
import { CircleCheck, Loader2 } from "lucide-react";
import {
  saveScoreAutomation,
  type ScoreAutomationState,
} from "@/lib/actions/automations";
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

const initial: ScoreAutomationState = {};

export interface SenderOption {
  id: string;
  name: string;
  email: string;
  telephonyConnected: boolean;
}

/**
 * Settings card form for the score-based auto-contact rule: when a lead's AI
 * score lands above/below the threshold, auto-send an SMS (via the chosen
 * sender's RingCentral/Dialpad) or flag the lead in the Contact Queue with
 * the message as the agent's script.
 */
export function ScoreAutomationForm({
  workspaceId,
  rule,
  senders,
}: {
  workspaceId: string;
  rule: {
    enabled: boolean;
    direction: "above" | "below";
    threshold: number;
    action: "sms" | "queue";
    message: string;
    senderUserId: string | null;
  };
  senders: SenderOption[];
}) {
  const [state, formAction, saving] = useActionState(saveScoreAutomation, initial);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [direction, setDirection] = useState<"above" | "below">(rule.direction);
  const [action, setAction] = useState<"sms" | "queue">(rule.action);
  const [sender, setSender] = useState(rule.senderUserId ?? "");

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="direction" value={direction} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="senderUserId" value={sender} />

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-input accent-primary"
        />
        Enable automation
      </label>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label>When a lead scores</Label>
          <Select
            value={direction}
            onValueChange={(v) => v && setDirection(v as "above" | "below")}
          >
            <SelectTrigger className="w-40" aria-label="Direction">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="above">At or above</SelectItem>
              <SelectItem value="below">At or below</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="automation-threshold">Score limit (0–100)</Label>
          <Input
            id="automation-threshold"
            name="threshold"
            type="number"
            min={0}
            max={100}
            defaultValue={rule.threshold}
            className="w-28"
          />
        </div>
        <div className="space-y-2">
          <Label>Then</Label>
          <Select
            value={action}
            onValueChange={(v) => v && setAction(v as "sms" | "queue")}
          >
            <SelectTrigger className="w-56" aria-label="Action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sms">Send an SMS automatically</SelectItem>
              <SelectItem value="queue">Flag in the Contact Queue</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {action === "sms" && (
        <div className="space-y-2">
          <Label>Send as</Label>
          <Select value={sender} onValueChange={(v) => v && setSender(v)}>
            <SelectTrigger className="w-full max-w-sm" aria-label="Sender">
              <SelectValue placeholder="Pick a team member…" />
            </SelectTrigger>
            <SelectContent>
              {senders.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.email})
                  {s.telephonyConnected ? "" : " — not connected"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The SMS goes out from this person&apos;s connected RingCentral or
            Dialpad number. Members marked &quot;not connected&quot; must first
            connect a provider in Settings before sends can work.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="automation-message">
          {action === "sms" ? "SMS message" : "Script shown to the agent"}
        </Label>
        <textarea
          id="automation-message"
          name="message"
          defaultValue={rule.message}
          rows={3}
          placeholder={
            action === "sms"
              ? "Hi {name}! Thanks for applying to {campaign} — are you available for a quick call today?"
              : "Ask about availability and confirm the license requirement…"
          }
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
        <p className="text-xs text-muted-foreground">
          Placeholders: <code>{"{name}"}</code> → lead&apos;s first name,{" "}
          <code>{"{campaign}"}</code> → campaign name.
          {action === "sms" &&
            " Each lead is texted at most once, and never if the team already contacted them."}
        </p>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state.success && (
        <p className="flex items-center gap-1 text-sm text-success">
          <CircleCheck className="h-4 w-4" />
          {state.success}
        </p>
      )}
      <Button type="submit" disabled={saving}>
        {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
        Save automation
      </Button>
    </form>
  );
}
