import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  fetchDriverApplications,
  isAlexYahConfigured,
  type AlexYahApplication,
} from "@/lib/integrations/alexyah";
import { geocodeCityCached } from "@/lib/integrations/geocode";
import { resolveLeadRegion } from "@/lib/lead-region";

/**
 * Mirrors AlexYah's driver applications into the lead pipeline.
 *
 * These people applied on the client's own hiring portal, unprompted. They
 * land as `source: "hiring_portal"` rather than "website": the /join form is
 * also "website", but those leads come out of the team's ad-comment work, and
 * the two have to stay apart to tell what we produced from what arrived alone.
 *
 * Their portal owns the applicant record; we own the sales pipeline. So this
 * writes on first sight and afterwards refreshes only the facts they are
 * authoritative about — contact details and their hiring stage — and never
 * touches the stage, score or notes our team has put on the lead.
 */

export interface AlexYahSyncStats {
  dryRun: boolean;
  skipped?: string;
  fetched: number;
  created: number;
  updated: number;
  /** Applications with no phone and no email — nothing to contact. */
  unusable: number;
  byStage: Record<string, number>;
}

/**
 * Their hiring stage → ours, for leads we create.
 *
 * Only ever used on first import. After that the team's own pipeline wins:
 * an agent who moved someone to "Interested" should not be dragged back
 * because the portal still says "new".
 */
const STAGE_MAP: Record<string, string> = {
  new: "New",
  reviewing: "Attempted to Contact",
  interview: "Interested",
  background: "In Contractor Compliance",
  approved: "Hired",
  rejected: "Lost - Do Not Contact",
};

const clean = (s: string | null | undefined) => {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
};

/** Their phones come formatted — "(510) 555-0142". Keep the digits. */
function normalizePhone(raw: string | null): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const ten = digits.slice(-10);
  return `+1${ten}`;
}

function fullName(a: AlexYahApplication): string {
  const name = [clean(a.firstName), clean(a.lastName)].filter(Boolean).join(" ");
  return name || clean(a.email) || "Unknown applicant";
}

/**
 * The document checklist, kept on the lead's form data so the team can see
 * how far along someone's paperwork is without leaving MarTech.
 */
function documentSummary(a: AlexYahApplication) {
  const received = a.documents.filter((d) => d.state === "received").length;
  const overdue = a.documents.filter((d) => d.state === "overdue").map((d) => d.label);
  return {
    documents_total: a.documents.length,
    documents_received: received,
    documents_overdue: overdue,
    documents: Object.fromEntries(a.documents.map((d) => [d.key, d.state])),
  };
}

export async function syncAlexYahApplications(
  workspaceSlug: string,
  opts: { dryRun?: boolean } = {},
): Promise<AlexYahSyncStats> {
  const dryRun = opts.dryRun ?? false;
  const empty: AlexYahSyncStats = {
    dryRun,
    fetched: 0,
    created: 0,
    updated: 0,
    unusable: 0,
    byStage: {},
  };

  if (!(await isAlexYahConfigured()))
    return { ...empty, skipped: "No AlexYah API key configured" };

  const [ws] = await db()
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, workspaceSlug))
    .limit(1);
  if (!ws) return { ...empty, skipped: `No workspace "${workspaceSlug}"` };

  const stages = await db()
    .select({ id: schema.stages.id, name: schema.stages.name, position: schema.stages.position })
    .from(schema.stages)
    .where(eq(schema.stages.workspaceId, ws.id));
  const stageByName = new Map(stages.map((s) => [s.name, s.id]));
  const firstStage = [...stages].sort((a, b) => a.position - b.position)[0];

  const existing = await db()
    .select({ id: schema.leads.id, externalId: schema.leads.externalId })
    .from(schema.leads)
    .where(
      and(
        eq(schema.leads.workspaceId, ws.id),
        eq(schema.leads.platform, "manual"),
        isNotNull(schema.leads.externalId),
      ),
    );
  const idByExternal = new Map(existing.map((l) => [l.externalId!, l.id]));

  const applications = await fetchDriverApplications();
  const stats: AlexYahSyncStats = { ...empty, fetched: applications.length };

  for (const a of applications) {
    stats.byStage[a.stage] = (stats.byStage[a.stage] ?? 0) + 1;

    const phone = normalizePhone(a.phone);
    const email = clean(a.email);
    if (!phone && !email) {
      stats.unusable++;
      continue;
    }

    const known = idByExternal.get(a.id);
    if (known) stats.updated++;
    else stats.created++;
    if (dryRun) continue;

    const city = clean(a.city);
    const geo = city ? await geocodeCityCached(city, clean(a.state)) : null;
    const geoRegion = resolveLeadRegion({
      formState: clean(a.state),
      city,
      geocodedRegion: geo?.region,
      phone,
    });

    if (known) {
      // Their portal owns the applicant; our team owns the pipeline. Refresh
      // only what they are the source of truth for.
      await db()
        .update(schema.leads)
        .set({
          name: fullName(a),
          email,
          phone,
          geoCity: city,
          geoRegion,
          formData: {
            first_name: clean(a.firstName),
            last_name: clean(a.lastName),
            source: "alexyah_portal",
            portal_stage: a.stage,
            portal_status: a.status,
            applied_at: a.appliedAt,
            interview_at: a.interviewAt,
            ...documentSummary(a),
          },
          updatedAt: new Date(),
        })
        .where(eq(schema.leads.id, known));
      continue;
    }

    await db().insert(schema.leads).values({
      workspaceId: ws.id,
      platform: "manual",
      source: "hiring_portal",
      externalId: a.id,
      name: fullName(a),
      email,
      phone,
      geoCity: city,
      geoRegion,
      geoLat: geo ? geo.lat.toFixed(6) : null,
      geoLng: geo ? geo.lng.toFixed(6) : null,
      formData: {
        first_name: clean(a.firstName),
        last_name: clean(a.lastName),
        source: "alexyah_portal",
        portal_stage: a.stage,
        portal_status: a.status,
        applied_at: a.appliedAt,
        interview_at: a.interviewAt,
        ...documentSummary(a),
      },
      stageId: stageByName.get(STAGE_MAP[a.stage] ?? "") ?? firstStage?.id ?? null,
      createdAt: a.appliedAt ? new Date(a.appliedAt) : new Date(),
    });
  }

  return stats;
}
