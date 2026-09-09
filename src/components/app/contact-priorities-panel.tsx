"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  Loader2,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Users,
  User,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import {
  applyContactPriorityAction,
  createContactPriority,
  deleteContactPriority,
  setContactPriorityActive,
  type PriorityInput,
} from "@/lib/actions/priorities";
import { PRIORITY_AUDIENCE_CAP, PRIORITY_MAX_BOOST } from "@/lib/contact-priority-config";
import type { ContactPriority } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ANY = "__any__";

/**
 * Contact priorities — the "who first this week" layer over lead scoring.
 * A supervisor writes the priority in plain words, scopes its audience
 * (campaign, states, lead age) and optionally aims it at one agent, then
 * applies it: the AI rates each audience lead's fit and the Contact Queue
 * adds up to +50 to the score for ordering. The campaign prompt (what a
 * good lead is) is never touched.
 */
export function ContactPrioritiesPanel({
  workspaceId,
  priorities,
  campaigns,
  agents,
  states,
}: {
  workspaceId: string;
  priorities: ContactPriority[];
  campaigns: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  states: string[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(priorities.length === 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const run = (id: string, fn: () => Promise<{ ok: boolean; error?: string } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setBusy(id);
      try {
        const r = await fn();
        if (!r.ok) toast.error(r.error ?? "Something went wrong");
        router.refresh();
      } finally {
        setBusy(null);
      }
    });

  const apply = (p: ContactPriority) =>
    startTransition(async () => {
      setBusy(`apply:${p.id}`);
      try {
        const r = await applyContactPriorityAction(workspaceId, p.id);
        if (r.ok)
          toast.success(
            `${p.name}: ${r.matched} of ${r.audience} lead${r.audience === 1 ? "" : "s"} match — the queue is reordered.`,
          );
        else toast.error(r.error ?? "Couldn't apply the priority.");
        router.refresh();
      } finally {
        setBusy(null);
      }
    });

  return (
    <div className="space-y-4">
      {priorities.length === 0 && !creating && (
        <p className="text-sm text-muted-foreground">
          No priorities yet — the queue orders new leads by score alone.
        </p>
      )}

      <ul className="space-y-2">
        {priorities.map((p) => {
          const scope = [
            p.campaignName ?? "All campaigns",
            p.regions.length ? p.regions.join(", ") : null,
            p.sinceDays ? `last ${p.sinceDays} days` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <li
              key={p.id}
              className={cn(
                "rounded-lg border p-3",
                !p.active && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {p.name}
                    <Badge variant="outline" className="gap-1 font-normal">
                      {p.agentId ? <User className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                      {p.agentName ?? "Whole team"}
                    </Badge>
                    {!p.active && (
                      <Badge variant="outline" className="font-normal">
                        Paused
                      </Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{scope}</p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm">{p.prompt}</p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {p.appliedAt
                      ? `Applied ${formatDistanceToNow(p.appliedAt, { addSuffix: true })} · ${p.matched} of ${p.appliedCount} leads boosted`
                      : "Not applied yet — press Apply so the queue picks it up"}
                    {p.createdBy ? ` · by ${p.createdBy}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant={p.appliedAt ? "outline" : "default"}
                    disabled={busy != null}
                    onClick={() => apply(p)}
                    title="Rate the audience with the AI and reorder the queue (uses AI credits)"
                  >
                    {busy === `apply:${p.id}` ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="mr-1 h-3.5 w-3.5" />
                    )}
                    {p.appliedAt ? "Re-apply" : "Apply"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy != null}
                    onClick={() =>
                      run(`toggle:${p.id}`, () =>
                        setContactPriorityActive(workspaceId, p.id, !p.active),
                      )
                    }
                    title={p.active ? "Pause — keep it, stop reordering" : "Resume"}
                  >
                    {busy === `toggle:${p.id}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : p.active ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy != null}
                    onClick={() =>
                      run(`del:${p.id}`, () => deleteContactPriority(workspaceId, p.id))
                    }
                    title="Delete — the queue goes back to score order"
                  >
                    {busy === `del:${p.id}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    )}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {creating ? (
        <NewPriorityForm
          workspaceId={workspaceId}
          campaigns={campaigns}
          agents={agents}
          states={states}
          onDone={() => {
            setCreating(false);
            router.refresh();
          }}
          onCancel={priorities.length ? () => setCreating(false) : undefined}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          New priority
        </Button>
      )}
    </div>
  );
}

function NewPriorityForm({
  workspaceId,
  campaigns,
  agents,
  states,
  onDone,
  onCancel,
}: {
  workspaceId: string;
  campaigns: { id: string; name: string }[];
  agents: { id: string; name: string }[];
  states: string[];
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [campaignId, setCampaignId] = useState(ANY);
  const [agentId, setAgentId] = useState(ANY);
  const [regions, setRegions] = useState<string[]>([]);
  const [sinceDays, setSinceDays] = useState("");
  const [applyNow, setApplyNow] = useState(true);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () =>
    startSave(async () => {
      setError(null);
      const input: PriorityInput = {
        name,
        prompt,
        campaignId: campaignId === ANY ? null : campaignId,
        agentId: agentId === ANY ? null : agentId,
        regions,
        sinceDays: sinceDays ? Number(sinceDays) : null,
      };
      const r = await createContactPriority(workspaceId, input);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (applyNow) {
        const a = await applyContactPriorityAction(workspaceId, r.id);
        if (a.ok)
          toast.success(
            `${name}: ${a.matched} of ${a.audience} lead${a.audience === 1 ? "" : "s"} match — the queue is reordered.`,
          );
        else toast.error(a.error ?? "Saved, but couldn't apply it.");
      } else {
        toast.success("Priority saved. Apply it when you're ready.");
      }
      onDone();
    });

  return (
    <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Sparkles className="h-4 w-4 text-primary" />
        New contact priority
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cp-name">Name</Label>
          <Input
            id="cp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Redondo push · week 37"
            disabled={saving}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cp-prompt">Who should the team call first?</Label>
          <textarea
            id="cp-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            disabled={saving}
            placeholder="e.g. Leads in or near Redondo Beach, and anyone who says they already hold a school-bus or passenger endorsement. Leads only available mornings matter less."
            className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
          />
          <p className="text-xs text-muted-foreground">
            Plain words. The AI rates each lead&apos;s fit 0–100 and the queue adds
            up to +{PRIORITY_MAX_BOOST} to its score. The campaign&apos;s scoring prompt
            stays as it is.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Campaign</Label>
          <Select value={campaignId} onValueChange={(v) => v && setCampaignId(v)} disabled={saving}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All campaigns</SelectItem>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>For</Label>
          <Select value={agentId} onValueChange={(v) => v && setAgentId(v)} disabled={saving}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Whole team</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} only
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>States</Label>
          <div className="flex flex-wrap gap-1.5">
            {states.length === 0 && (
              <span className="text-xs text-muted-foreground">Any</span>
            )}
            {states.map((s) => {
              const on = regions.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    setRegions((r) => (on ? r.filter((x) => x !== s) : [...r, s]))
                  }
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-background hover:border-primary",
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">None selected = any state.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cp-since">Lead age</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Last</span>
            <Input
              id="cp-since"
              type="number"
              min={1}
              max={365}
              value={sinceDays}
              onChange={(e) => setSinceDays(e.target.value)}
              placeholder="any"
              className="w-24"
              disabled={saving}
            />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Queue-eligible leads only, newest {PRIORITY_AUDIENCE_CAP} at most.
          </p>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={applyNow}
          onChange={(e) => setApplyNow(e.target.checked)}
          disabled={saving}
        />
        Apply right away (rates the audience with the AI — uses credits)
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={saving || !name.trim() || !prompt.trim()} onClick={submit}>
          {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          {applyNow ? "Save & apply" : "Save"}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
