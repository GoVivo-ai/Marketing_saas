/**
 * Deterministic demo dataset so the product can be demoed end-to-end
 * before any platform connection exists. Mirrors the real DB shapes.
 * Remove once live syncing is enabled for all workspaces.
 */

export interface DemoWorkspace {
  id: string;
  name: string;
  slug: string;
  industry: string;
  accentColor: string;
}

export const demoWorkspaces: DemoWorkspace[] = [
  { id: "ws-alexia", name: "Alexia Transport", slug: "alexia", industry: "Student Transportation", accentColor: "#6366f1" },
  { id: "ws-fts", name: "FTS", slug: "fts", industry: "Logistics", accentColor: "#10b981" },
  { id: "ws-vectora", name: "Vectora", slug: "vectora", industry: "Professional Services", accentColor: "#f59e0b" },
];

export interface DemoCampaign {
  id: string;
  name: string;
  platform: "meta" | "google_ads";
  status: "ACTIVE" | "PAUSED";
  objective: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number;
  trend: number; // % week-over-week CPL change (negative = improving)
}

export const demoCampaigns: DemoCampaign[] = [
  { id: "c1", name: "Driver Recruitment — Atlanta", platform: "meta", status: "ACTIVE", objective: "LEAD_GENERATION", spend: 2840.5, impressions: 412000, clicks: 9840, leads: 312, cpl: 9.1, trend: -12.4 },
  { id: "c2", name: "Driver Recruitment — Dallas", platform: "meta", status: "ACTIVE", objective: "LEAD_GENERATION", spend: 2210.0, impressions: 358000, clicks: 7150, leads: 198, cpl: 11.16, trend: 3.2 },
  { id: "c3", name: "Brand Awareness — Q2", platform: "meta", status: "ACTIVE", objective: "AWARENESS", spend: 980.25, impressions: 890000, clicks: 4320, leads: 0, cpl: 0, trend: 0 },
  { id: "c4", name: "Retargeting — Site Visitors", platform: "meta", status: "ACTIVE", objective: "CONVERSIONS", spend: 640.8, impressions: 96000, clicks: 2880, leads: 84, cpl: 7.63, trend: -8.1 },
  { id: "c5", name: "Search — Driver Jobs (planned)", platform: "google_ads", status: "PAUSED", objective: "LEADS", spend: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0, trend: 0 },
];

/** Last 30 days of daily spend/leads, oldest first. */
export const demoDailySeries = Array.from({ length: 30 }, (_, i) => {
  const base = 180 + Math.sin(i / 4.5) * 40 + (i % 7 < 2 ? -35 : 12);
  const leads = Math.max(4, Math.round(base / 11 + Math.sin(i / 3) * 4));
  const d = new Date(Date.UTC(2026, 4, 10 + i)); // fixed window: May 10 – Jun 8, 2026
  return {
    date: d.toISOString().slice(0, 10),
    spend: Math.round(base * 100) / 100,
    leads,
    clicks: leads * 28 + (i % 5) * 14,
  };
});

export interface DemoLead {
  id: string;
  name: string;
  email: string;
  phone: string;
  campaign: string;
  status: "new" | "contacted" | "qualified" | "won" | "lost";
  aiScore: number;
  aiReason: string;
  createdAt: string;
}

export const demoLeads: DemoLead[] = [
  { id: "l1", name: "Marcus Johnson", email: "marcus.j@gmail.com", phone: "+1 404 555 0182", campaign: "Driver Recruitment — Atlanta", status: "new", aiScore: 92, aiReason: "CDL holder, 5+ yrs experience, available immediately", createdAt: "2026-06-08T14:22:00Z" },
  { id: "l2", name: "Sandra Mills", email: "sandramills88@yahoo.com", phone: "+1 678 555 0124", campaign: "Driver Recruitment — Atlanta", status: "new", aiScore: 78, aiReason: "Valid license, asks about part-time schedule", createdAt: "2026-06-08T11:05:00Z" },
  { id: "l3", name: "Derrick Owens", email: "d.owens@outlook.com", phone: "+1 214 555 0147", campaign: "Driver Recruitment — Dallas", status: "contacted", aiScore: 85, aiReason: "Former school bus driver, clean record stated", createdAt: "2026-06-07T19:40:00Z" },
  { id: "l4", name: "Patricia Lane", email: "plane.work@gmail.com", phone: "+1 469 555 0093", campaign: "Driver Recruitment — Dallas", status: "qualified", aiScore: 88, aiReason: "Completed all form fields, references available", createdAt: "2026-06-07T08:15:00Z" },
  { id: "l5", name: "Kevin Tran", email: "ktran2026@gmail.com", phone: "+1 404 555 0066", campaign: "Retargeting — Site Visitors", status: "won", aiScore: 95, aiReason: "Returning visitor, applied twice, interview scheduled", createdAt: "2026-06-06T16:30:00Z" },
  { id: "l6", name: "Test Entry", email: "asdf@test.com", phone: "—", campaign: "Driver Recruitment — Atlanta", status: "lost", aiScore: 8, aiReason: "Junk submission: placeholder email, empty answers", createdAt: "2026-06-06T03:12:00Z" },
];

export const demoInsights = [
  {
    kind: "anomaly" as const,
    severity: "critical" as const,
    title: "CPL in Dallas jumped 18% in the last 4 days",
    body: "Driver Recruitment — Dallas went from $9.45 to $11.16 CPL while CTR dropped from 2.2% to 1.9%. Creative fatigue is the most likely cause: frequency reached 4.1. Next step: rotate in the 2 new video creatives and cap frequency at 2.5.",
  },
  {
    kind: "recommendation" as const,
    severity: "info" as const,
    title: "Atlanta is ready to scale: +30% budget recommended",
    body: "Atlanta has held a $9.10 CPL (12% below target) for 3 consecutive weeks with stable 2.4% CTR. Raising the daily budget from $135 to $175 should add ~45 leads/week at similar efficiency. Next step: apply the increase Monday and watch CPL for 72h.",
  },
  {
    kind: "weekly_summary" as const,
    severity: "info" as const,
    title: "Week in review: 594 leads at $9.86 blended CPL",
    body: "Total spend $5,671 (-4% WoW) produced 594 leads (+9% WoW). Quality is up too: average AI lead score rose from 71 to 76. Retargeting remains the most efficient channel at $7.63 CPL.",
  },
];

export const demoKpis = {
  spend: { value: 5671.55, deltaPct: -4.2 },
  leads: { value: 594, deltaPct: 9.1 },
  cpl: { value: 9.86, deltaPct: -11.8 },
  ctr: { value: 2.31, deltaPct: 4.6 },
};
