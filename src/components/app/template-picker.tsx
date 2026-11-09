"use client";

import { useEffect, useState } from "react";
import { ChevronDown, FileText, Loader2, Plus } from "lucide-react";
import {
  listMessageTemplates,
  type AgentVars,
  type MessageTemplate,
} from "@/lib/actions/message-templates";
import {
  renderTemplate,
  type TemplateChannel,
  type TemplateVars,
} from "@/lib/message-templates";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The lead-side values a compose surface knows about. */
export interface LeadVars {
  name: string | null;
  city?: string | null;
  state?: string | null;
  campaign?: string | null;
}

/** Loads the workspace's templates for a channel plus the agent's signature. */
export function useMessageTemplates(channel: TemplateChannel | null) {
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [agent, setAgent] = useState<AgentVars | null>(null);
  useEffect(() => {
    if (!channel) return;
    let active = true;
    listMessageTemplates(channel)
      .then((r) => {
        if (!active) return;
        setTemplates(r.templates);
        setAgent(r.agent);
      })
      .catch(() => {
        if (active) setTemplates([]);
      });
    return () => {
      active = false;
    };
  }, [channel]);
  return { templates, agent, loading: templates === null };
}

export function fillTemplate(
  t: Pick<MessageTemplate, "subject" | "body">,
  lead: LeadVars,
  agent: AgentVars | null,
): { subject: string; body: string } {
  const vars: TemplateVars = {
    name: lead.name,
    city: lead.city,
    state: lead.state,
    campaign: lead.campaign,
    company: agent?.company,
    agentName: agent?.agentName,
    agentPhone: agent?.agentPhone,
    agentEmail: agent?.agentEmail,
  };
  return {
    subject: t.subject ? renderTemplate(t.subject, vars) : "",
    body: renderTemplate(t.body, vars),
  };
}

/**
 * "Use template ▾" — a dropdown of the workspace's templates for one
 * channel; picking one hands back the filled subject/body. Renders nothing
 * when the workspace has no templates, so surfaces without them look as
 * they did before.
 */
export function TemplatePicker({
  channel,
  lead,
  onPick,
  size = "sm",
  data,
}: {
  channel: TemplateChannel;
  lead: LeadVars;
  onPick: (filled: { subject: string; body: string }, template: MessageTemplate) => void;
  size?: "sm" | "xs";
  /** Already-loaded templates (from ComposeTools); loads its own otherwise. */
  data?: ReturnType<typeof useMessageTemplates>;
}) {
  const own = useMessageTemplates(data ? null : channel);
  const { templates, agent, loading } = data ?? own;
  if (loading)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Templates…
      </span>
    );
  if (!templates || templates.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size={size === "xs" ? "sm" : size}
            className={size === "xs" ? "h-7 px-2 text-xs" : undefined}
          />
        }
      >
        <FileText className="mr-1.5 h-3.5 w-3.5" />
        Use template
        <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {channel === "sms" ? "SMS templates" : "Email templates"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {templates.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onClick={() => onPick(fillTemplate(t, lead, agent), t)}
              className="flex-col items-start gap-0.5"
            >
              <span className="font-medium">{t.name}</span>
              <span className="line-clamp-1 text-xs text-muted-foreground">
                {t.subject ?? t.body}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One-click values for a message written on the spot: the lead's name and
 * city, the organization, the agent's own name, number and email. Each chip
 * inserts the real value where the cursor is — no placeholder syntax for the
 * agent to learn. Chips without a value (no city, no phone) aren't shown.
 */
export function InsertChips({
  lead,
  agent,
  onInsert,
  className,
}: {
  lead: LeadVars;
  agent: AgentVars | null;
  onInsert: (value: string) => void;
  className?: string;
}) {
  const first = (lead.name ?? "").trim().split(/\s+/)[0] ?? "";
  const rest = (lead.name ?? "").trim().split(/\s+/).slice(1).join(" ");
  const agentFirst = (agent?.agentName ?? "").trim().split(/\s+/)[0] ?? "";
  const chips: { label: string; value: string | null | undefined }[] = [
    { label: "First name", value: first },
    { label: "Last name", value: rest },
    { label: "City", value: lead.city },
    { label: "State", value: lead.state },
    { label: "Campaign", value: lead.campaign },
    { label: "Company", value: agent?.company },
    { label: "My name", value: agentFirst },
    { label: "My phone", value: agent?.agentPhone },
    { label: "My email", value: agent?.agentEmail },
  ];
  const visible = chips.filter((c) => (c.value ?? "").trim() && c.value !== "—");
  if (visible.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <span className="mr-0.5 text-[11px] text-muted-foreground">Insert:</span>
      {visible.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={() => onInsert(c.value!.trim())}
          title={`Insert "${c.value!.trim()}"`}
          className="inline-flex items-center gap-0.5 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[11px] hover:bg-muted"
        >
          <Plus className="h-2.5 w-2.5 opacity-60" />
          {c.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Inserts `value` at the textarea's cursor (replacing a selection), pads it
 * with spaces when it lands against a word, and returns the new text plus
 * where the cursor should go. Pure, so both dialogs share it.
 */
export function insertAtCursor(
  el: HTMLTextAreaElement | HTMLInputElement | null,
  current: string,
  value: string,
): { text: string; cursor: number } {
  const start = el?.selectionStart ?? current.length;
  const end = el?.selectionEnd ?? current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^[\s,.!?]/.test(after) ? " " : "";
  const inserted = `${lead}${value}${trail}`;
  return { text: before + inserted + after, cursor: start + inserted.length };
}

/**
 * The compose toolbar both dialogs share: the template picker (when the
 * workspace has templates) and the insert chips for ad-hoc messages. Loads
 * the templates and the agent's values once.
 */
export function ComposeTools({
  channel,
  lead,
  onPick,
  onInsert,
  right,
}: {
  channel: TemplateChannel;
  lead: LeadVars;
  onPick: (filled: { subject: string; body: string }, template: MessageTemplate) => void;
  onInsert: (value: string) => void;
  /** Something to show at the right end of the first row (e.g. a counter). */
  right?: React.ReactNode;
}) {
  const data = useMessageTemplates(channel);
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <TemplatePicker channel={channel} lead={lead} onPick={onPick} data={data} />
        {right}
      </div>
      <InsertChips lead={lead} agent={data.agent} onInsert={onInsert} />
    </div>
  );
}
