"use client";

import { useEffect, useState } from "react";
import { ChevronDown, FileText, Loader2 } from "lucide-react";
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
export function useMessageTemplates(channel: TemplateChannel) {
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [agent, setAgent] = useState<AgentVars | null>(null);
  useEffect(() => {
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
}: {
  channel: TemplateChannel;
  lead: LeadVars;
  onPick: (filled: { subject: string; body: string }, template: MessageTemplate) => void;
  size?: "sm" | "xs";
}) {
  const { templates, agent, loading } = useMessageTemplates(channel);
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
