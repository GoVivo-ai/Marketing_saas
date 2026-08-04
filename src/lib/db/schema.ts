import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  date,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────

/** Global role of a user inside Vivo's organization. */
export const userRoleEnum = pgEnum("user_role", [
  "agency_admin", // Vivo team — full access to every workspace
  "agency_member", // Vivo team — access to assigned workspaces
  "client", // Client user — restricted to their own workspace(s)
  "developer", // Platform engineer — everything admins see + the /dev dashboard
]);

/** Role of a user inside a specific workspace (client account). */
export const workspaceRoleEnum = pgEnum("workspace_role", [
  "admin", // full access to their company + team management
  "supervisor", // full access to their company's platform
  "agent", // Leads, Contact Queue and Pipeline only
]);

export const platformEnum = pgEnum("platform", [
  "meta", // Facebook + Instagram Ads (Phase 1)
  "google_ads", // Phase 2
  "tiktok", // Phase 3
  "linkedin", // Phase 3
  "manual", // Leads entered by hand (e.g. direct referrals from a client)
]);

export const connectionStatusEnum = pgEnum("connection_status", [
  "active",
  "expired",
  "error",
  "disconnected",
]);

export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "contacted",
  "qualified",
  "won",
  "lost",
]);

export const insightKindEnum = pgEnum("insight_kind", [
  "weekly_summary",
  "anomaly",
  "recommendation",
  "forecast",
]);

export const syncStatusEnum = pgEnum("sync_status", [
  "running",
  "success",
  "failed",
]);

// ─────────────────────────────────────────────────────────────────────────
// Platform settings (encrypted secrets managed from the UI)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Agency-level credentials (Meta system-user token, Anthropic API key…)
 * configured from Settings → Connections. Values are AES-256-GCM encrypted
 * with TOKEN_ENCRYPTION_KEY — the only secrets that stay in env are
 * infrastructure ones (DB, auth, encryption key, cron).
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  valueEnc: text("value_enc").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────
// Identity & tenancy
// ─────────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  role: userRoleEnum("role").notNull().default("client"),
  image: text("image"),
  // RingCentral per-user connection (AES-256-GCM encrypted tokens). Each user
  // self-connects their own RC account to call/SMS leads from the platform.
  rcAccessTokenEnc: text("rc_access_token_enc"),
  rcRefreshTokenEnc: text("rc_refresh_token_enc"),
  rcTokenExpiresAt: timestamp("rc_token_expires_at"),
  rcRefreshTokenExpiresAt: timestamp("rc_refresh_token_expires_at"),
  /** The user's own RingCentral number used as the "from" for RingOut/SMS. */
  rcFromNumber: text("rc_from_number"),
  rcOwnerId: text("rc_owner_id"),
  rcConnectedAt: timestamp("rc_connected_at"),
  // Dialpad per-user connection (same pattern as RingCentral). Calls/SMS are
  // keyed by the user's numeric Dialpad id, stored in dp_user_id.
  dpAccessTokenEnc: text("dp_access_token_enc"),
  dpRefreshTokenEnc: text("dp_refresh_token_enc"),
  dpTokenExpiresAt: timestamp("dp_token_expires_at"),
  dpRefreshTokenExpiresAt: timestamp("dp_refresh_token_expires_at"),
  /** The user's own Dialpad number, shown in Settings as the "from". */
  dpFromNumber: text("dp_from_number"),
  dpUserId: text("dp_user_id"),
  dpConnectedAt: timestamp("dp_connected_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * A workspace is one client of Vivo (e.g. Alexia, FTS, Vectora).
 * Every piece of marketing data is scoped to exactly one workspace —
 * this is the multi-tenancy boundary.
 */
export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  industry: text("industry"),
  logoUrl: text("logo_url"),
  /**
   * What a "conversion/result" is called for this client — the business
   * outcome leads convert into (e.g. "Sales", "Hires", "Appointments").
   * Generic so the Planner isn't hard-wired to one campaign type.
   */
  resultLabel: text("result_label").notNull().default("Sales"),
  /**
   * Free-text criteria the client uses to define a good lead (e.g. budget,
   * location, role). Fed to the AI lead-scoring engine so scores reflect
   * what actually matters for this client's business.
   */
  qualificationCriteria: text("qualification_criteria"),
  /** Short AI digest of qualificationCriteria for agent-facing surfaces. */
  qualificationCriteriaSummary: text("qualification_criteria_summary"),
  /** Brand color used to theme the client portal. */
  accentColor: text("accent_color"),
  /**
   * This client's own Meta system-user token (AES-256-GCM encrypted). Each
   * client has its own token; the Connections page lists and syncs that
   * client's ad accounts with it.
   */
  metaAccessTokenEnc: text("meta_access_token_enc"),
  /** This client's own Anthropic API key (encrypted) for AI scoring/insights. */
  anthropicApiKeyEnc: text("anthropic_api_key_enc"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("agent"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("workspace_member_unique").on(t.workspaceId, t.userId)],
);

// ─────────────────────────────────────────────────────────────────────────
// Platform connections & campaign data
// ─────────────────────────────────────────────────────────────────────────

/** An authenticated link between a workspace and an ad platform account. */
export const connections = pgTable("connections", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  platform: platformEnum("platform").notNull(),
  /** External account id, e.g. Meta `act_xxxx`. */
  accountId: text("account_id").notNull(),
  accountName: text("account_name"),
  /** AES-256-GCM encrypted — never store raw tokens. */
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: timestamp("token_expires_at"),
  status: connectionStatusEnum("status").notNull().default("active"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    objective: text("objective"),
    dailyBudget: numeric("daily_budget", { precision: 12, scale: 2 }),
    /**
     * Per-campaign AI lead-scoring criteria (free-text prompt). When set, it
     * overrides the workspace-wide `qualificationCriteria` for leads belonging
     * to this campaign — so each campaign can be scored on its own terms.
     * Nullable = fall back to the workspace criteria. Preserved across re-syncs
     * (the platform upsert never writes this column).
     */
    scoringCriteria: text("scoring_criteria"),
    /**
     * Short AI-generated digest of scoringCriteria (a few bullets), shown to
     * agents in the Contact Queue instead of the full prompt. Regenerated
     * whenever the criteria is saved.
     */
    scoringCriteriaSummary: text("scoring_criteria_summary"),
    /**
     * The questions of the campaign's lead-gen form(s), refreshed from the
     * platform on every sync. Source of truth for the fields shown next to
     * the scoring-criteria editor — reflects the CURRENT form even before
     * any lead has answered it (lead formData only shows past submissions).
     */
    formQuestions: jsonb("form_questions").$type<
      { key: string; label?: string; type?: string }[]
    >(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("campaign_external_unique").on(t.connectionId, t.externalId),
    index("campaign_workspace_idx").on(t.workspaceId),
  ],
);

/** One row per campaign per day — the atom of all reporting. */
export const metricsDaily = pgTable(
  "metrics_daily",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    spend: numeric("spend", { precision: 12, scale: 2 }).notNull().default("0"),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    /** Platform-reported extras (reach, frequency, video views…). */
    extra: jsonb("extra"),
  },
  (t) => [
    uniqueIndex("metrics_daily_unique").on(t.campaignId, t.date),
    index("metrics_workspace_date_idx").on(t.workspaceId, t.date),
  ],
);

/**
 * Ad sets live one level below campaigns. In geo-targeted accounts each ad set
 * targets a single city with a radius (its "audience location"), so we persist
 * that targeting geometry — city name, region/state, radius and the geocoded
 * lat/lng — to render each ad set as a circle on a map.
 */
export const adsets = pgTable(
  "adsets",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    // Audience location (first targeted city) — null when the ad set isn't
    // city-targeted (e.g. region/country-level or custom locations).
    cityName: text("city_name"),
    cityRegion: text("city_region"),
    cityCountry: text("city_country"),
    radius: numeric("radius", { precision: 8, scale: 2 }),
    distanceUnit: text("distance_unit"), // "mile" | "kilometer"
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("adset_external_unique").on(t.connectionId, t.externalId),
    index("adset_campaign_idx").on(t.campaignId),
    index("adset_workspace_idx").on(t.workspaceId),
  ],
);

/** One row per ad set per day — same grain as metricsDaily, one level deeper. */
export const adsetMetricsDaily = pgTable(
  "adset_metrics_daily",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    adsetId: text("adset_id")
      .notNull()
      .references(() => adsets.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    spend: numeric("spend", { precision: 12, scale: 2 }).notNull().default("0"),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    conversions: integer("conversions").notNull().default(0),
    extra: jsonb("extra"),
  },
  (t) => [
    uniqueIndex("adset_metrics_daily_unique").on(t.adsetId, t.date),
    index("adset_metrics_workspace_date_idx").on(t.workspaceId, t.date),
  ],
);

/**
 * Saved campaign plan — a workspace can keep any number of named plans. Each
 * plan is anchored to a month and captures the planned funnel (max budget →
 * target CPL → leads → conversion rate → sales) so it can be compared against
 * what was actually executed.
 */
export const monthlyPlans = pgTable(
  "monthly_plans",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** User-facing plan name, freely editable (e.g. "June push — Miami"). */
    name: text("name").notNull().default(""),
    /** First day of the planned month (e.g. 2026-06-01) — the plan's anchor. */
    month: date("month").notNull(),
    /**
     * Optional campaign window. When set, actuals & pacing use this range
     * instead of the whole calendar month (campaigns rarely line up with it).
     */
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    budget: numeric("budget", { precision: 14, scale: 2 }).notNull().default("0"),
    targetCpl: numeric("target_cpl", { precision: 12, scale: 2 }).notNull().default("0"),
    /** Lead → sale conversion rate, stored as a fraction (0.15 = 15%). */
    conversionRate: numeric("conversion_rate", { precision: 6, scale: 4 })
      .notNull()
      .default("0"),
    targetLeads: integer("target_leads").notNull().default(0),
    targetSales: integer("target_sales").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("monthly_plan_workspace_month_idx").on(t.workspaceId, t.month)],
);

/**
 * Per-city goal within a saved plan — one row per targeted city. The city is
 * keyed by name (ad sets churn month to month, cities persist). Leads and
 * budget per city are derived from this goal + the plan's CPL & conversion.
 */
export const planCityTargets = pgTable(
  "plan_city_targets",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => monthlyPlans.id, { onDelete: "cascade" }),
    month: date("month").notNull(),
    cityName: text("city_name").notNull(),
    /** Full state/region name from Meta's geo db (e.g. "Florida"). */
    region: text("region"),
    /** Target results (in the workspace's result unit) for this city. */
    targetResults: integer("target_results").notNull().default(0),
  },
  (t) => [uniqueIndex("plan_city_unique").on(t.planId, t.cityName)],
);

// ─────────────────────────────────────────────────────────────────────────
// Pipeline stages — customizable funnel columns, one ordered set per client
// ─────────────────────────────────────────────────────────────────────────

export const stages = pgTable(
  "stages",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Column accent color (hex). */
    color: text("color"),
    /** Funnel semantics so reporting/AI can tell outcomes apart. */
    kind: text("kind").notNull().default("open"), // open | won | lost
    /**
     * Whether leads in this stage still need outreach. Open stages that are
     * handled elsewhere (e.g. "In Contractor Compliance" — the lead is being
     * onboarded in an external system) opt out so their leads leave the
     * contact queue instead of resurfacing as follow-ups.
     */
    workable: boolean("workable").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("stage_workspace_position_idx").on(t.workspaceId, t.position)],
);

// ─────────────────────────────────────────────────────────────────────────
// Leads — the unified inbox that replaces duplicated spreadsheets
// ─────────────────────────────────────────────────────────────────────────

export const leads = pgTable(
  "leads",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: text("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    platform: platformEnum("platform").notNull(),
    externalId: text("external_id"),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    /** The ad set the lead came from — carries the audience-location radius. */
    adsetId: text("adset_id").references(() => adsets.id, {
      onDelete: "set null",
    }),
    /** City the lead reported in the form (raw), and its geocoded position. */
    geoCity: text("geo_city"),
    /** State/region the lead reported (e.g. "Florida") — manual/public leads. */
    geoRegion: text("geo_region"),
    geoLat: numeric("geo_lat", { precision: 9, scale: 6 }),
    geoLng: numeric("geo_lng", { precision: 9, scale: 6 }),
    /** Raw form answers exactly as the platform delivered them. */
    formData: jsonb("form_data"),
    status: leadStatusEnum("status").notNull().default("new"),
    /** Customizable pipeline stage (authoritative for the Kanban board). */
    stageId: text("stage_id").references(() => stages.id, {
      onDelete: "set null",
    }),
    /** 0–100, assigned by the AI lead-scoring engine (radius boost included). */
    aiScore: integer("ai_score"),
    /** Portion of aiScore earned for being inside the ad set's radius. */
    radiusBoost: integer("radius_boost").notNull().default(0),
    aiScoreReason: text("ai_score_reason"),
    /** Concrete next step for sales, generated alongside the score. */
    aiSuggestedAction: text("ai_suggested_action"),
    /**
     * RCA disqualification reason (the spreadsheet's RCA Lvl 1/2/3) — set when a
     * lead is marked lost/not-qualified. Three levels: driver → category →
     * specific reason, from the shared taxonomy in src/lib/rca.ts.
     */
    disqualL1: text("disqual_l1"),
    disqualL2: text("disqual_l2"),
    disqualL3: text("disqual_l3"),
    assignedToId: text("assigned_to_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Soft "being worked right now" claim: set when an agent pulls the lead
     * up in the queue or opens its detail, honored for a short TTL so two
     * agents don't contact the same lead at once. Expires on its own — never
     * a hard lock.
     */
    workingById: text("working_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    workingAt: timestamp("working_at"),
    /**
     * When the score automation auto-contacted this lead (SMS). Doubles as the
     * idempotency guard: a lead is auto-contacted at most once, even across
     * re-scores.
     */
    autoContactedAt: timestamp("auto_contacted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_external_unique").on(t.workspaceId, t.platform, t.externalId),
    index("lead_workspace_status_idx").on(t.workspaceId, t.status),
  ],
);

/**
 * Named, reusable AI scoring-criteria prompts. Saved from the campaign
 * scoring editor so the same criteria can be loaded into other campaigns,
 * tweaked and re-saved. Shows who created it and when.
 */
export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    content: text("content").notNull(),
    createdById: text("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("prompt_template_name_unique").on(t.workspaceId, t.name)],
);

/**
 * Score-based auto-contact rule, one per workspace. When enabled, every lead
 * whose fresh AI score lands above/below the threshold is contacted
 * automatically: either an SMS is sent through the sender's connected
 * telephony account (RingCentral/Dialpad), or the lead is highlighted in the
 * Contact Queue with `message` as the agent's script.
 */
export const scoreAutomations = pgTable("score_automations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  /** Contact leads scoring "above" (>=) or "below" (<=) the threshold. */
  direction: text("direction").notNull().default("above"),
  threshold: integer("threshold").notNull().default(70),
  /** "sms" = send automatically; "queue" = flag in the Contact Queue. */
  action: text("action").notNull().default("sms"),
  /** SMS body or agent script. Supports {name} and {campaign} placeholders. */
  message: text("message").notNull().default(""),
  /** Whose telephony account sends the automated SMS. */
  senderUserId: text("sender_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Geocoding cache — maps a "City, Region, Country" query to coordinates so we
 * geocode each distinct place once (OpenStreetMap Nominatim is rate-limited).
 */
export const geocache = pgTable("geocache", {
  query: text("query").primaryKey(),
  lat: numeric("lat", { precision: 9, scale: 6 }).notNull(),
  lng: numeric("lng", { precision: 9, scale: 6 }).notNull(),
  /** Resolved place name (e.g. the city a ZIP code belongs to). */
  name: text("name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Append-only activity log per lead: notes, status changes, calls. */
export const leadEvents = pgTable("lead_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  leadId: text("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  type: text("type").notNull(), // note | status_change | call | sms | whatsapp | email
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────
// AI insights & reporting
// ─────────────────────────────────────────────────────────────────────────

export const aiInsights = pgTable(
  "ai_insights",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: insightKindEnum("kind").notNull(),
    severity: text("severity").notNull().default("info"), // info | warning | critical
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Structured evidence backing the insight (metrics, deltas, ids). */
    data: jsonb("data"),
    acknowledgedAt: timestamp("acknowledged_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("insight_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const reports = pgTable("reports", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  /** AI-written executive summary shown to the client. */
  summary: text("summary"),
  fileUrl: text("file_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const syncRuns = pgTable("sync_runs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  connectionId: text("connection_id")
    .notNull()
    .references(() => connections.id, { onDelete: "cascade" }),
  status: syncStatusEnum("status").notNull().default("running"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  finishedAt: timestamp("finished_at"),
  /** Row counts per entity: { campaigns: 12, metrics: 340, leads: 28 } */
  stats: jsonb("stats"),
  error: text("error"),
});

/**
 * Provider call log mirrored from RingCentral, one row per call leg per user.
 * This is the source of truth for agent talk time: RingOut events in
 * lead_events only prove a call was placed — duration/result live here.
 * Calls are matched to leads by E.164 phone; unmatched rows keep leadId null
 * so off-platform calls still count toward the agent's activity.
 */
export const callLogs = pgTable(
  "call_logs",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("ringcentral"),
    /** The provider's own record id — dedupe key together with userId. */
    externalId: text("external_id").notNull(),
    direction: text("direction"), // Inbound | Outbound
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    startTime: timestamp("start_time").notNull(),
    durationSec: integer("duration_sec").notNull().default(0),
    /** Provider result, e.g. "Call connected", "Missed", "Voicemail". */
    result: text("result"),
    leadId: text("lead_id").references(() => leads.id, { onDelete: "set null" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("call_log_external_unique").on(t.userId, t.externalId),
    index("call_log_user_start_idx").on(t.userId, t.startTime),
    index("call_log_workspace_start_idx").on(t.workspaceId, t.startTime),
  ],
);

// ─────────────────────────────────────────────────────────────────────────
// Dispatch module — replaces the ops team's loose spreadsheets. The MDD
// (EverDriven driver id) is the thread that joins drivers to their covers,
// compliance interactions and schedule rows across every source system.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Driver master — the platform-native replacement of the "All Drivers" Excel.
 * One row per driver; the MDD identifies them across EverDriven, SharePoint
 * and the dispatch bot.
 */
export const dispatchDrivers = pgTable(
  "dispatch_drivers",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** EverDriven driver id — the cross-system key. Null when not assigned yet. */
    mdd: text("mdd"),
    name: text("name").notNull(),
    /** Uppercased, accent/space-normalized name for cross-source matching. */
    normName: text("norm_name").notNull(),
    state: text("state"),
    area: text("area"),
    address: text("address"),
    status: text("status").notNull().default("active"), // active | inactive
    /** Whether the driver currently has routes assigned (master file split). */
    hasRoutes: boolean("has_routes").notNull().default(true),
    phone: text("phone"),
    email: text("email"),
    emergencyName: text("emergency_name"),
    emergencyPhone: text("emergency_phone"),
    emergencyRelation: text("emergency_relation"),
    camera: boolean("camera").notNull().default(false),
    carSeats: integer("car_seats").notNull().default(0),
    boosterSeats: integer("booster_seats").notNull().default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dispatch_driver_mdd_unique").on(t.workspaceId, t.mdd),
    index("dispatch_driver_workspace_idx").on(t.workspaceId),
    index("dispatch_driver_norm_name_idx").on(t.workspaceId, t.normName),
  ],
);

/**
 * Ride covers — a driver can't make a trip and a rescue driver takes it.
 * Platform-native replacement of the "Ride Covers" Excel; raw names are kept
 * next to the resolved driver ids so imports never lose information.
 */
export const dispatchCovers = pgTable(
  "dispatch_covers",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Day the absence was reported. */
    date: timestamp("date"),
    /** Day the rescue actually covers. */
    rescueDate: timestamp("rescue_date"),
    company: text("company"),
    area: text("area"),
    reason: text("reason"),
    driverId: text("driver_id").references(() => dispatchDrivers.id, {
      onDelete: "set null",
    }),
    driverName: text("driver_name"),
    rescueDriverId: text("rescue_driver_id").references(
      () => dispatchDrivers.id,
      { onDelete: "set null" },
    ),
    rescueName: text("rescue_name"),
    payment: text("payment"),
    comments: text("comments"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("dispatch_cover_workspace_idx").on(t.workspaceId, t.date),
    index("dispatch_cover_driver_idx").on(t.driverId),
    index("dispatch_cover_rescue_idx").on(t.rescueDriverId),
  ],
);

/**
 * Compliance interactions — mirror of the SharePoint "Driver Incidents
 * Report" list (the company's official record; billing depends on it).
 * SharePoint stays the system of record: this table is a synced read model
 * (one-off CSV import today, Microsoft Graph sync next), keyed by spItemId.
 */
export const dispatchInteractions = pgTable(
  "dispatch_interactions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** SharePoint list item id once synced via Graph; null on CSV imports. */
    spItemId: text("sp_item_id"),
    driverId: text("driver_id").references(() => dispatchDrivers.id, {
      onDelete: "set null",
    }),
    driverName: text("driver_name"),
    priority: text("priority"),
    status: text("status"),
    /** Plain-text description (SharePoint's HTML stripped on import). */
    description: text("description"),
    classification: text("classification"),
    category: text("category"),
    /** SharePoint multi-choice, stored as JSON array of strings. */
    subCategories: jsonb("sub_categories"),
    assignedTo: text("assigned_to"),
    createdBy: text("created_by"),
    modifiedBy: text("modified_by"),
    /** Timestamps as recorded in SharePoint. */
    spCreatedAt: timestamp("sp_created_at"),
    spModifiedAt: timestamp("sp_modified_at"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("dispatch_interaction_sp_unique").on(t.workspaceId, t.spItemId),
    index("dispatch_interaction_workspace_idx").on(t.workspaceId, t.spCreatedAt),
    index("dispatch_interaction_driver_idx").on(t.driverId),
  ],
);

// ─────────────────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(workspaceMembers),
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  connections: many(connections),
  campaigns: many(campaigns),
  leads: many(leads),
  insights: many(aiInsights),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [workspaceMembers.userId],
    references: [users.id],
  }),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [campaigns.workspaceId],
    references: [workspaces.id],
  }),
  connection: one(connections, {
    fields: [campaigns.connectionId],
    references: [connections.id],
  }),
  metrics: many(metricsDaily),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [leads.workspaceId],
    references: [workspaces.id],
  }),
  campaign: one(campaigns, {
    fields: [leads.campaignId],
    references: [campaigns.id],
  }),
  events: many(leadEvents),
}));
