import { randomBytes } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { geocodeCityCached } from "@/lib/integrations/geocode";
import { resolveLeadRegion } from "@/lib/lead-region";
import { postToSlack } from "@/lib/slack";

/**
 * Inbound lead webhook: any external tool POSTs JSON to the workspace's URL
 * and the row becomes a lead. Built for Vivo's own careers site first, but
 * nothing here is specific to it — a client's website form, a hiring portal
 * or Zapier can post the same shape.
 *
 * Accepted body: a flat lead object, or `{ event, data }` where `data` is
 * the lead (the shape govivo.ai sends). Recognised fields are lifted into
 * the lead's columns; everything else is kept as form answers.
 */

export interface InboundWebhookRow {
  id: string;
  workspaceId: string;
  token: string;
  slackWebhookUrl: string | null;
  receivedCount: number;
  lastReceivedAt: Date | null;
  createdAt: Date;
}

/** Events that create a lead. Anything else is acknowledged and ignored. */
const CREATE_EVENTS = new Set(["application.created", "lead.created"]);

export const newWebhookToken = () => randomBytes(24).toString("hex");

export async function getInboundWebhook(
  workspaceId: string,
): Promise<InboundWebhookRow | null> {
  const [row] = await db()
    .select()
    .from(schema.inboundWebhooks)
    .where(eq(schema.inboundWebhooks.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

/** Public URL a tool posts to. Prefers the configured app URL, else the request host. */
export function inboundWebhookUrl(base: string, token: string): string {
  return `${base.replace(/\/$/, "")}/api/webhooks/leads/${token}`;
}

// ---------------------------------------------------------------------------
// Payload normalisation

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => {
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};

/** Keys lifted into lead columns; the rest stays in formData verbatim. */
const LIFTED = new Set([
  "id",
  "external_id",
  "first_name",
  "firstName",
  "last_name",
  "lastName",
  "name",
  "full_name",
  "email",
  "phone",
  "city",
  "state",
  "created_at",
  "createdAt",
]);

export interface NormalisedLead {
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  createdAt: Date | null;
  extra: Record<string, unknown>;
}

/**
 * Unwraps `{ event, data }` envelopes and maps the common field spellings.
 * Returns null when the event says this isn't a new lead.
 */
export function normaliseInbound(body: unknown): NormalisedLead | null {
  if (!body || typeof body !== "object") return null;
  let obj = body as Json;
  if (typeof obj.event === "string") {
    if (!CREATE_EVENTS.has(obj.event)) return null;
    if (!obj.data || typeof obj.data !== "object") return null;
    obj = obj.data as Json;
  }

  const firstName = str(obj.first_name) ?? str(obj.firstName);
  const lastName = str(obj.last_name) ?? str(obj.lastName);
  const fullName = str(obj.name) ?? str(obj.full_name);
  const name = fullName ?? [firstName, lastName].filter(Boolean).join(" ") ?? "";
  const createdRaw = str(obj.created_at) ?? str(obj.createdAt);
  const created = createdRaw ? new Date(createdRaw) : null;

  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (LIFTED.has(k) || v === null || v === undefined || v === "") continue;
    extra[k] = v;
  }

  return {
    externalId: str(obj.external_id) ?? str(obj.id),
    firstName,
    lastName,
    name: name || "Unknown",
    email: str(obj.email),
    phone: str(obj.phone),
    city: str(obj.city),
    state: str(obj.state),
    createdAt: created && !Number.isNaN(created.getTime()) ? created : null,
    extra,
  };
}

// ---------------------------------------------------------------------------
// Ingest

export async function ingestInboundLead(
  hook: InboundWebhookRow,
  lead: NormalisedLead,
): Promise<{ leadId: string; created: boolean }> {
  const workspaceId = hook.workspaceId;

  // Idempotent on the sender's id, so a retried webhook never duplicates.
  const externalId = lead.externalId ? `webhook:${lead.externalId}` : null;
  if (externalId) {
    const [existing] = await db()
      .select({ id: schema.leads.id })
      .from(schema.leads)
      .where(
        and(eq(schema.leads.workspaceId, workspaceId), eq(schema.leads.externalId, externalId)),
      )
      .limit(1);
    if (existing) return { leadId: existing.id, created: false };
  }

  // Same landing spot as every other new lead: the first open stage.
  const [firstStage] = await db()
    .select({ id: schema.stages.id })
    .from(schema.stages)
    .where(and(eq(schema.stages.workspaceId, workspaceId), eq(schema.stages.kind, "open")))
    .orderBy(asc(schema.stages.position))
    .limit(1);

  const geo = lead.city ? await geocodeCityCached(lead.city, lead.state) : null;
  const geoRegion = resolveLeadRegion({
    formState: lead.state,
    city: lead.city,
    geocodedRegion: geo?.region,
    phone: lead.phone,
  });

  const [row] = await db()
    .insert(schema.leads)
    .values({
      workspaceId,
      platform: "manual",
      // A website or portal posting on the applicant's behalf, not an agent
      // typing: same channel the AlexYah portal import uses.
      source: "hiring_portal",
      externalId,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      geoCity: lead.city,
      geoRegion,
      geoLat: geo ? geo.lat.toFixed(6) : null,
      geoLng: geo ? geo.lng.toFixed(6) : null,
      stageId: firstStage?.id ?? null,
      createdAt: lead.createdAt ?? new Date(),
      formData: {
        first_name: lead.firstName,
        last_name: lead.lastName,
        source: "webhook",
        ...lead.extra,
      },
    })
    .returning({ id: schema.leads.id });

  await db()
    .update(schema.inboundWebhooks)
    .set({
      receivedCount: sql`${schema.inboundWebhooks.receivedCount} + 1`,
      lastReceivedAt: new Date(),
    })
    .where(eq(schema.inboundWebhooks.id, hook.id));

  return { leadId: row.id, created: true };
}

/** Announces the lead in the workspace's Slack channel, linking to its sheet. */
export async function notifyInboundLead(
  hook: InboundWebhookRow,
  lead: NormalisedLead,
  leadId: string,
  appBase: string,
): Promise<void> {
  if (!hook.slackWebhookUrl) return;
  const link = appBase ? `${appBase.replace(/\/$/, "")}/leads?lead=${leadId}` : null;
  // The first short answers give the reader context without opening the lead.
  const facts = Object.entries(lead.extra)
    .filter(([, v]) => typeof v === "string" && v.length <= 80)
    .slice(0, 4)
    .map(([k, v]) =>
      /^https?:\/\//.test(v as string) ? `<${v}|${humanize(k)}>` : `${humanize(k)}: ${v}`,
    );
  await postToSlack(hook.slackWebhookUrl, {
    text: `New lead: ${lead.name}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*New lead* — ${link ? `<${link}|${lead.name}>` : lead.name}${
            lead.email || lead.phone ? `\n${[lead.email, lead.phone].filter(Boolean).join(" · ")}` : ""
          }`,
        },
      },
      ...(facts.length
        ? [{ type: "context", elements: [{ type: "mrkdwn", text: facts.join("  ·  ") }] }]
        : []),
    ],
  });
}

const humanize = (k: string) =>
  k.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
