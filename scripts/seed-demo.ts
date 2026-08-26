/**
 * Seeds (or resets) the shareable demo: copies one real workspace into the
 * "demo" workspace with every identity anonymized, and upserts the demo user
 * that the /demo link signs visitors in as.
 *
 *   npx tsx scripts/seed-demo.ts               # copy the biggest workspace
 *   npx tsx scripts/seed-demo.ts --from alexyah # copy a specific one (slug)
 *
 * Re-running it wipes and rebuilds the demo workspace, so it doubles as the
 * "reset the playground" button. Safe against production data: it only ever
 * deletes the workspace whose slug is "demo".
 *
 * What gets anonymized:
 *  - lead names / emails / phones → deterministic fake identities
 *  - form answers, AI reasons, disqualification notes → identities scrubbed
 *  - human notes → replaced with canned sample notes
 *  - event authors → the demo user
 *  - campaign/adset/plan names + criteria → source company name scrubbed
 *  - daily metrics → jittered per campaign so real spend isn't disclosed
 * Reports, call logs, credentials and dispatch data are never copied.
 */
process.loadEnvFile(".env.local");
import postgres from "postgres";

const DEMO_SLUG = "demo";
const DEMO_EMAIL = "demo@govivo.ai";

const FIRST = [
  "Carlos", "Maria", "James", "Ana", "Luis", "Sofia", "Michael", "Elena",
  "David", "Carmen", "Jose", "Laura", "Kevin", "Diana", "Miguel", "Sarah",
  "Andres", "Jessica", "Robert", "Paola", "Victor", "Nicole", "Oscar",
  "Melissa", "Daniel", "Andrea", "Brian", "Camila", "Jorge", "Emily",
  "Ricardo", "Natalia", "Steven", "Valeria", "Hector", "Amanda", "Pedro",
  "Lucia", "Frank", "Gabriela",
];
const LAST = [
  "Ramirez", "Johnson", "Garcia", "Smith", "Torres", "Brown", "Martinez",
  "Davis", "Lopez", "Wilson", "Hernandez", "Moore", "Gonzalez", "Taylor",
  "Perez", "Anderson", "Sanchez", "Thomas", "Rivera", "Jackson", "Flores",
  "White", "Gomez", "Harris", "Diaz", "Martin", "Cruz", "Thompson",
  "Morales", "Clark", "Reyes", "Lewis", "Ortiz", "Walker", "Castillo",
  "Hall", "Vargas", "Young", "Mendoza", "King",
];
const CANNED_NOTES = [
  "Called — very interested, asked about the weekly schedule.",
  "Left a voicemail, will try again tomorrow morning.",
  "Answered all questions, wants to start as soon as possible.",
  "Asked about pay and requirements, sounds like a good fit.",
  "No answer on first try. Sent a follow-up text.",
  "Confirmed availability and vehicle details over the phone.",
  "Wants a call back after 5pm — works mornings.",
  "Spoke briefly, sending the onboarding info by text.",
];

type Row = Record<string, unknown>;

function fakeIdentity(i: number) {
  const first = FIRST[i % FIRST.length];
  const last = LAST[Math.floor(i / FIRST.length + i * 7) % LAST.length];
  const area = 702 + (Math.floor(i / 900) % 3) * 23; // 702, 725, 748
  const phone = `+1${area}555${String(100 + (i % 900)).padStart(4, "0")}`;
  return {
    name: `${first} ${last}`,
    first,
    last,
    email: `${first}.${last}${i}@example.com`.toLowerCase(),
    phone,
  };
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const LONG_DIGITS_RE = /[+(]?\d[\d\s().-]{6,}\d/g;

/** Builds a scrubber that erases one real identity from free text. */
function makeScrubber(real: { name?: string | null; email?: string | null; phone?: string | null }, fake: ReturnType<typeof fakeIdentity>) {
  const nameTokens = (real.name ?? "")
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const nameRe = nameTokens.length ? new RegExp(nameTokens.join("|"), "gi") : null;
  return (text: string): string => {
    let out = text;
    if (nameRe) out = out.replace(nameRe, fake.first);
    out = out.replace(EMAIL_RE, fake.email);
    out = out.replace(LONG_DIGITS_RE, fake.phone);
    return out;
  };
}

/** Deep-copies a JSON value, scrubbing strings and remapping known ids. */
function scrubJson(value: unknown, scrub: (s: string) => string, idMap: Map<string, string>): unknown {
  if (typeof value === "string")
    return idMap.get(value) ?? scrub(value);
  if (Array.isArray(value)) return value.map((v) => scrubJson(v, scrub, idMap));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Row).map(([k, v]) => [k, scrubJson(v, scrub, idMap)]),
    );
  return value;
}

/** Deterministic per-campaign metric jitter so real spend isn't disclosed. */
function jitterFactor(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 0.85 + (h % 30) / 100; // 0.85 – 1.14
}

const uuid = () => crypto.randomUUID();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const fromIdx = process.argv.indexOf("--from");
  const fromSlug = fromIdx >= 0 ? process.argv[fromIdx + 1] : null;

  // 1) Source workspace: --from <slug>, or the one with the most leads.
  const [src] = fromSlug
    ? await sql`SELECT * FROM workspaces WHERE slug = ${fromSlug}`
    : await sql`
        SELECT w.* FROM workspaces w
        LEFT JOIN leads l ON l.workspace_id = w.id
        WHERE w.slug <> ${DEMO_SLUG} AND w.is_active
        GROUP BY w.id ORDER BY count(l.id) DESC LIMIT 1`;
  if (!src) throw new Error(`Source workspace not found${fromSlug ? `: ${fromSlug}` : ""}`);
  if (src.slug === DEMO_SLUG) throw new Error("Source can't be the demo workspace itself");
  console.log(`Source: ${src.name} (${src.slug})`);

  // Scrubs the source company's name out of campaign/plan/insight text.
  const srcNameRe = new RegExp(
    String(src.name)
      .split(/\s+/)
      .filter((t: string) => t.length >= 3)
      .map((t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|"),
    "gi",
  );
  const scrubCompany = (s: string) => s.replace(srcNameRe, "Demo");

  // 2) Wipe any previous demo workspace (cascades to all its data).
  await sql`DELETE FROM workspaces WHERE slug = ${DEMO_SLUG}`;

  // 3) Demo workspace + user + membership. The user has no password — the
  //    only way in is the /demo link's passwordless provider.
  const wsId = uuid();
  await sql`
    INSERT INTO workspaces (id, name, slug, industry, result_label, qualification_criteria, accent_color, is_active)
    VALUES (${wsId}, 'Demo Company', ${DEMO_SLUG}, ${src.industry},
            ${src.result_label}, ${src.qualification_criteria ? scrubCompany(src.qualification_criteria) : null},
            ${src.accent_color}, true)`;

  const [demoUser] = await sql`
    INSERT INTO users (id, name, email, password_hash, role)
    VALUES (${uuid()}, 'Demo Visitor', ${DEMO_EMAIL}, NULL, 'client')
    ON CONFLICT (email) DO UPDATE SET name = 'Demo Visitor', role = 'client', password_hash = NULL
    RETURNING id`;
  await sql`
    INSERT INTO workspace_members (id, workspace_id, user_id, role)
    VALUES (${uuid()}, ${wsId}, ${demoUser.id}, 'supervisor')`;

  // 4) A placeholder "active" connection so the workspace reads as connected
  //    and campaigns have a parent. No token — sync is impossible by design.
  const connId = uuid();
  await sql`
    INSERT INTO connections (id, workspace_id, platform, account_id, account_name, status, last_synced_at)
    VALUES (${connId}, ${wsId}, 'meta', 'act_demo', 'Demo Ad Account', 'active', now())`;

  const idMap = new Map<string, string>(); // old id → new id (stages, campaigns, adsets, leads)
  const insert = async (table: string, rows: Row[]) => {
    for (let i = 0; i < rows.length; i += 500)
      await sql`INSERT INTO ${sql(table)} ${sql(rows.slice(i, i + 500))}`;
  };

  // 5) Stages.
  const stages = await sql`SELECT * FROM stages WHERE workspace_id = ${src.id}`;
  await insert(
    "stages",
    stages.map((s) => {
      const id = uuid();
      idMap.set(s.id, id);
      return { id, workspace_id: wsId, name: s.name, color: s.color, kind: s.kind, workable: s.workable, position: s.position };
    }),
  );

  // 6) Campaigns.
  const campaigns = await sql`SELECT * FROM campaigns WHERE workspace_id = ${src.id}`;
  await insert(
    "campaigns",
    campaigns.map((c) => {
      const id = uuid();
      idMap.set(c.id, id);
      return {
        id, workspace_id: wsId, connection_id: connId, platform: c.platform,
        external_id: `demo_${id.slice(0, 8)}`, name: scrubCompany(c.name),
        status: c.status, objective: c.objective, daily_budget: c.daily_budget,
        scoring_criteria: c.scoring_criteria ? scrubCompany(c.scoring_criteria) : null,
        scoring_criteria_summary: c.scoring_criteria_summary ? scrubCompany(c.scoring_criteria_summary) : null,
        form_questions: c.form_questions ? sql.json(c.form_questions as never) : null,
      };
    }),
  );

  // 7) Ad sets (geo targeting kept — it powers the map).
  const adsets = await sql`SELECT * FROM adsets WHERE workspace_id = ${src.id}`;
  await insert(
    "adsets",
    adsets.map((a) => {
      const id = uuid();
      idMap.set(a.id, id);
      return {
        id, workspace_id: wsId, connection_id: connId,
        campaign_id: idMap.get(a.campaign_id)!, platform: a.platform,
        external_id: `demo_${id.slice(0, 8)}`, name: scrubCompany(a.name),
        status: a.status, city_name: a.city_name, city_region: a.city_region,
        city_country: a.city_country, radius: a.radius, distance_unit: a.distance_unit,
        lat: a.lat, lng: a.lng,
      };
    }),
  );

  // 8) Daily metrics, jittered per campaign/ad set.
  const metrics = await sql`SELECT * FROM metrics_daily WHERE workspace_id = ${src.id}`;
  await insert(
    "metrics_daily",
    metrics.map((m) => {
      const f = jitterFactor(m.campaign_id);
      return {
        id: uuid(), workspace_id: wsId, campaign_id: idMap.get(m.campaign_id)!,
        date: m.date, spend: (Number(m.spend) * f).toFixed(2),
        impressions: Math.round(m.impressions * f), clicks: Math.round(m.clicks * f),
        leads: Math.round(m.leads * f), conversions: Math.round(m.conversions * f),
        extra: null,
      };
    }),
  );
  const adsetMetrics = await sql`SELECT * FROM adset_metrics_daily WHERE workspace_id = ${src.id}`;
  await insert(
    "adset_metrics_daily",
    adsetMetrics.map((m) => {
      const f = jitterFactor(m.adset_id);
      return {
        id: uuid(), workspace_id: wsId, adset_id: idMap.get(m.adset_id)!,
        date: m.date, spend: (Number(m.spend) * f).toFixed(2),
        impressions: Math.round(m.impressions * f), clicks: Math.round(m.clicks * f),
        leads: Math.round(m.leads * f), conversions: Math.round(m.conversions * f),
        extra: null,
      };
    }),
  );

  // 9) Leads — the heart of the anonymization.
  const leads = await sql`SELECT * FROM leads WHERE workspace_id = ${src.id} ORDER BY created_at`;
  const scrubbers = new Map<string, (s: string) => string>();
  await insert(
    "leads",
    leads.map((l, i) => {
      const fake = fakeIdentity(i);
      const scrub = makeScrubber(l, fake);
      const id = uuid();
      idMap.set(l.id, id);
      scrubbers.set(l.id, scrub);

      // Form answers: identity fields get the fake identity, everything else
      // keeps its value but with names/emails/phones scrubbed out.
      let formData: Row | null = null;
      if (l.form_data && typeof l.form_data === "object") {
        formData = {};
        for (const [k, v] of Object.entries(l.form_data as Row)) {
          if (/name|nombre/i.test(k)) formData[k] = fake.name;
          else if (/mail/i.test(k)) formData[k] = fake.email;
          else if (/phone|tel/i.test(k)) formData[k] = fake.phone;
          else formData[k] = scrubJson(v, scrub, idMap);
        }
      }

      return {
        id, workspace_id: wsId, campaign_id: l.campaign_id ? idMap.get(l.campaign_id) ?? null : null,
        platform: l.platform, external_id: `demo_${id.slice(0, 8)}`,
        name: fake.name, email: l.email ? fake.email : null, phone: l.phone ? fake.phone : null,
        adset_id: l.adset_id ? idMap.get(l.adset_id) ?? null : null,
        geo_city: l.geo_city, geo_region: l.geo_region, geo_lat: l.geo_lat, geo_lng: l.geo_lng,
        form_data: formData ? sql.json(formData as never) : null,
        status: l.status, stage_id: l.stage_id ? idMap.get(l.stage_id) ?? null : null,
        cc_status: l.cc_status,
        ai_score: l.ai_score, radius_boost: l.radius_boost,
        ai_score_reason: l.ai_score_reason ? scrub(l.ai_score_reason) : null,
        ai_suggested_action: l.ai_suggested_action ? scrub(l.ai_suggested_action) : null,
        disqual_l1: l.disqual_l1, disqual_l2: l.disqual_l2, disqual_l3: l.disqual_l3,
        assigned_to_id: null, working_by_id: null, working_at: null,
        auto_contacted_at: l.auto_contacted_at,
        created_at: l.created_at, updated_at: l.updated_at,
      };
    }),
  );

  // 10) Lead activity. Human notes become canned samples; generated events
  //     keep their payload with identities scrubbed and stage ids remapped.
  //     Every author becomes the demo user so no agent name leaks.
  const events = await sql`
    SELECT e.* FROM lead_events e
    JOIN leads l ON l.id = e.lead_id
    WHERE l.workspace_id = ${src.id}
    ORDER BY e.created_at`;
  let noteI = 0;
  await insert(
    "lead_events",
    events
      .filter((e) => idMap.has(e.lead_id))
      .map((e) => {
        const scrub = scrubbers.get(e.lead_id)!;
        const payload =
          e.type === "note"
            ? { text: CANNED_NOTES[noteI++ % CANNED_NOTES.length] }
            : scrubJson(e.payload, scrub, idMap);
        return {
          id: uuid(), lead_id: idMap.get(e.lead_id)!,
          user_id: e.user_id ? demoUser.id : null,
          type: e.type, payload: payload == null ? null : sql.json(payload as never),
          created_at: e.created_at,
        };
      }),
  );

  // 11) AI insights (recent ones; structured evidence dropped — it can carry
  //     real ids/names) and saved plans.
  const insights = await sql`
    SELECT * FROM ai_insights WHERE workspace_id = ${src.id}
    ORDER BY created_at DESC LIMIT 12`;
  await insert(
    "ai_insights",
    insights.map((n) => ({
      id: uuid(), workspace_id: wsId, kind: n.kind, severity: n.severity,
      title: scrubCompany(n.title), body: scrubCompany(n.body), data: null,
      acknowledged_at: n.acknowledged_at, created_at: n.created_at,
    })),
  );

  const plans = await sql`SELECT * FROM monthly_plans WHERE workspace_id = ${src.id}`;
  for (const p of plans) {
    const id = uuid();
    idMap.set(p.id, id);
    await sql`
      INSERT INTO monthly_plans (id, workspace_id, name, month, period_start, period_end,
        budget, target_cpl, conversion_rate, target_leads, target_sales, notes, created_at, updated_at)
      VALUES (${id}, ${wsId}, ${scrubCompany(p.name)}, ${p.month}, ${p.period_start}, ${p.period_end},
        ${p.budget}, ${p.target_cpl}, ${p.conversion_rate}, ${p.target_leads}, ${p.target_sales},
        ${p.notes ? scrubCompany(p.notes) : null}, ${p.created_at}, ${p.updated_at})`;
  }
  const cityTargets = await sql`
    SELECT t.* FROM plan_city_targets t
    JOIN monthly_plans p ON p.id = t.plan_id
    WHERE p.workspace_id = ${src.id}`;
  await insert(
    "plan_city_targets",
    cityTargets
      .filter((t) => idMap.has(t.plan_id))
      .map((t) => ({
        id: uuid(), workspace_id: wsId, plan_id: idMap.get(t.plan_id)!,
        month: t.month, city_name: t.city_name, region: t.region,
        target_results: t.target_results,
      })),
  );

  console.log(`
Demo workspace rebuilt:
  stages          ${stages.length}
  campaigns       ${campaigns.length}
  ad sets         ${adsets.length}
  daily metrics   ${metrics.length} (+${adsetMetrics.length} ad-set rows)
  leads           ${leads.length}
  lead events     ${events.length}
  insights        ${insights.length}
  plans           ${plans.length}

Share the link:  <your-app-url>/demo${process.env.DEMO_ACCESS_KEY ? "?key=" + process.env.DEMO_ACCESS_KEY : ""}
`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
