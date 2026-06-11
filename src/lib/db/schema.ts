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
]);

/** Role of a user inside a specific workspace (client account). */
export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "editor",
  "viewer",
]);

export const platformEnum = pgEnum("platform", [
  "meta", // Facebook + Instagram Ads (Phase 1)
  "google_ads", // Phase 2
  "tiktok", // Phase 3
  "linkedin", // Phase 3
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
   * Free-text criteria the client uses to define a good lead (e.g. budget,
   * location, role). Fed to the AI lead-scoring engine so scores reflect
   * what actually matters for this client's business.
   */
  qualificationCriteria: text("qualification_criteria"),
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
    role: workspaceRoleEnum("role").notNull().default("viewer"),
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
    /** Raw form answers exactly as the platform delivered them. */
    formData: jsonb("form_data"),
    status: leadStatusEnum("status").notNull().default("new"),
    /** Customizable pipeline stage (authoritative for the Kanban board). */
    stageId: text("stage_id").references(() => stages.id, {
      onDelete: "set null",
    }),
    /** 0–100, assigned by the AI lead-scoring engine. */
    aiScore: integer("ai_score"),
    aiScoreReason: text("ai_score_reason"),
    /** Concrete next step for sales, generated alongside the score. */
    aiSuggestedAction: text("ai_suggested_action"),
    assignedToId: text("assigned_to_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_external_unique").on(t.workspaceId, t.platform, t.externalId),
    index("lead_workspace_status_idx").on(t.workspaceId, t.status),
  ],
);

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
