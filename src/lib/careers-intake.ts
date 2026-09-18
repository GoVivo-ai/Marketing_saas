import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { postToSlack } from "@/lib/slack";

/**
 * Vivo's own careers page (govivo.ai) fires a webhook per application; this
 * turns it into a lead in the Vivo workspace so the team works applicants
 * from Martek — Contact Queue, pipeline, calls — instead of an inbox.
 *
 * The site owns the application row and the resume file (private bucket);
 * the lead keeps a long-lived signed link to the resume plus the answers.
 * Idempotent on the application id, so a retried webhook never duplicates.
 */

export interface CareersApplication {
  id: string | number;
  role?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  english?: string | null;
  experience?: string | null;
  story?: string | null;
  resume_name?: string | null;
  /** Signed download link, minted by the site when it fires the webhook. */
  resume_url?: string | null;
  created_at?: string | null;
}

/** Marks these leads' formData so the source can be told apart from AlexYah's portal. */
export const CAREERS_FORM_SOURCE = "vivo_careers";

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};

export async function ingestCareersApplication(
  workspaceSlug: string,
  a: CareersApplication,
): Promise<{ leadId: string; created: boolean }> {
  const [ws] = await db()
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, workspaceSlug))
    .limit(1);
  if (!ws) throw new Error(`Workspace "${workspaceSlug}" not found`);

  const externalId = `${CAREERS_FORM_SOURCE}:${a.id}`;
  const [existing] = await db()
    .select({ id: schema.leads.id })
    .from(schema.leads)
    .where(
      and(eq(schema.leads.workspaceId, ws.id), eq(schema.leads.externalId, externalId)),
    )
    .limit(1);
  if (existing) return { leadId: existing.id, created: false };

  // Same landing spot as every other new lead: the first open stage.
  const [firstStage] = await db()
    .select({ id: schema.stages.id })
    .from(schema.stages)
    .where(and(eq(schema.stages.workspaceId, ws.id), eq(schema.stages.kind, "open")))
    .orderBy(asc(schema.stages.position))
    .limit(1);

  const firstName = clean(a.first_name);
  const lastName = clean(a.last_name);
  const name = [firstName, lastName].filter(Boolean).join(" ") || "Applicant";

  const [lead] = await db()
    .insert(schema.leads)
    .values({
      workspaceId: ws.id,
      platform: "manual",
      source: "hiring_portal",
      externalId,
      name,
      email: clean(a.email),
      phone: clean(a.phone),
      stageId: firstStage?.id ?? null,
      createdAt: a.created_at ? new Date(a.created_at) : new Date(),
      formData: {
        first_name: firstName,
        last_name: lastName,
        source: CAREERS_FORM_SOURCE,
        role: clean(a.role),
        linkedin: clean(a.linkedin),
        english_level: clean(a.english),
        experience: clean(a.experience),
        story: clean(a.story),
        resume: clean(a.resume_url),
        resume_name: clean(a.resume_name),
      },
    })
    .returning({ id: schema.leads.id });

  return { leadId: lead.id, created: true };
}

/** Tells the recruiting channel; the link opens the lead sheet in Martek. */
export async function notifyCareersApplication(
  a: CareersApplication,
  leadId: string,
): Promise<void> {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const name =
    [clean(a.first_name), clean(a.last_name)].filter(Boolean).join(" ") || "Applicant";
  const role = clean(a.role) ?? "Careers application";
  const link = base ? `${base}/leads?lead=${leadId}` : null;
  const facts = [
    clean(a.english) && `English: ${clean(a.english)}`,
    clean(a.experience) && `Experience: ${clean(a.experience)}`,
    clean(a.linkedin) && `<${clean(a.linkedin)}|LinkedIn>`,
    clean(a.resume_url) && `<${clean(a.resume_url)}|Resume>`,
  ].filter(Boolean);

  await postToSlack(process.env.APPLY_SLACK_WEBHOOK_URL, {
    text: `New applicant: ${name} · ${role}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*New applicant* — ${link ? `<${link}|${name}>` : name}\n${role}`,
        },
      },
      ...(facts.length
        ? [{ type: "context", elements: [{ type: "mrkdwn", text: facts.join("  ·  ") }] }]
        : []),
    ],
  });
}
