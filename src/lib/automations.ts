import { and, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { sendText, normalizeE164 } from "@/lib/integrations/telephony";

/**
 * Score-based auto-contact automation.
 *
 * A workspace can define one rule (Settings → Workspace → Score automation):
 * when a lead's AI score lands above/below a threshold, either send it an SMS
 * automatically through a team member's connected telephony account, or flag
 * it in the Contact Queue with a ready-to-use script. `runScoreAutomation` is
 * called right after every place a lead gets (re)scored — sync, pending-lead
 * drain, and campaign re-score.
 */

export interface ScoreAutomationRule {
  enabled: boolean;
  direction: "above" | "below";
  threshold: number;
  action: "sms" | "queue";
  message: string;
  senderUserId: string | null;
}

export async function getScoreAutomation(
  workspaceId: string,
): Promise<ScoreAutomationRule | null> {
  const [row] = await db()
    .select()
    .from(schema.scoreAutomations)
    .where(eq(schema.scoreAutomations.workspaceId, workspaceId))
    .limit(1);
  if (!row) return null;
  return {
    enabled: row.enabled,
    direction: row.direction === "below" ? "below" : "above",
    threshold: row.threshold,
    action: row.action === "queue" ? "queue" : "sms",
    message: row.message,
    senderUserId: row.senderUserId,
  };
}

/** Does a score match the rule's threshold condition? */
export function scoreMatchesRule(
  score: number,
  rule: Pick<ScoreAutomationRule, "direction" | "threshold">,
): boolean {
  return rule.direction === "below"
    ? score <= rule.threshold
    : score >= rule.threshold;
}

/** Fill {name} / {campaign} placeholders with the lead's data. */
function renderMessage(
  template: string,
  lead: { name: string | null; campaign: string | null },
): string {
  const firstName = lead.name?.trim().split(/\s+/)[0] ?? "";
  return template
    .replaceAll("{name}", firstName || "there")
    .replaceAll("{campaign}", lead.campaign ?? "");
}

/**
 * Auto-contacts the given (just-scored) leads per the workspace rule.
 * Only the "sms" action acts here — "queue" leads are highlighted at render
 * time in the Contact Queue, no write needed. Safe to call with any lead ids:
 * every filter (threshold, phone, not already contacted) re-checks in SQL.
 * Never throws; a failed send leaves the lead un-contacted for a later pass.
 */
export async function runScoreAutomation(
  workspaceId: string,
  leadIds: string[],
): Promise<{ sent: number }> {
  if (!leadIds.length) return { sent: 0 };
  const rule = await getScoreAutomation(workspaceId);
  if (!rule?.enabled || rule.action !== "sms") return { sent: 0 };
  if (!rule.senderUserId || !rule.message.trim()) return { sent: 0 };

  const candidates = await db()
    .select({
      id: schema.leads.id,
      name: schema.leads.name,
      phone: schema.leads.phone,
      aiScore: schema.leads.aiScore,
      campaign: schema.campaigns.name,
    })
    .from(schema.leads)
    .leftJoin(schema.campaigns, eq(schema.leads.campaignId, schema.campaigns.id))
    .where(
      and(
        eq(schema.leads.workspaceId, workspaceId),
        inArray(schema.leads.id, leadIds),
        isNotNull(schema.leads.phone),
        isNotNull(schema.leads.aiScore),
        // Once per lead, ever — re-scores never re-text.
        isNull(schema.leads.autoContactedAt),
        // Don't auto-text disqualified leads.
        isNull(schema.leads.disqualL1),
        rule.direction === "below"
          ? sql`${schema.leads.aiScore} <= ${rule.threshold}`
          : sql`${schema.leads.aiScore} >= ${rule.threshold}`,
      ),
    );

  let sent = 0;
  for (const lead of candidates) {
    // A human may already be talking to this lead — never text over an
    // existing conversation.
    const [touched] = await db()
      .select({ id: schema.leadEvents.id })
      .from(schema.leadEvents)
      .where(
        and(
          eq(schema.leadEvents.leadId, lead.id),
          inArray(schema.leadEvents.type, ["call", "sms", "whatsapp", "email"]),
        ),
      )
      .limit(1);
    if (touched) continue;

    let to: string;
    try {
      to = normalizeE164(lead.phone!);
    } catch {
      continue; // unusable number — skip silently
    }

    const body = renderMessage(rule.message, lead);
    try {
      const res = await sendText(rule.senderUserId, to, body);
      await db().insert(schema.leadEvents).values({
        leadId: lead.id,
        userId: rule.senderUserId,
        type: "sms",
        payload: { to, text: body, messageId: res.id, via: res.via, automated: true },
      });
      await db()
        .update(schema.leads)
        .set({ autoContactedAt: new Date() })
        .where(eq(schema.leads.id, lead.id));
      sent++;
    } catch {
      // Sender not connected or provider error — leave autoContactedAt null
      // so the next scoring pass can retry once the connection is fixed.
    }
  }
  return { sent };
}
