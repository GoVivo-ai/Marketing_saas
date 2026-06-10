# Roadmap

## Phase 1 — Foundation & Meta (current)

- [x] Project scaffold: Next.js 16, TypeScript, Tailwind v4, shadcn/ui
- [x] Multi-tenant Postgres schema (Drizzle): workspaces, members, connections,
      campaigns, daily metrics, leads, AI insights, reports, sync runs
- [x] Auth.js v5 with roles (agency vs client) + demo mode
- [x] Product shell: overview dashboard, campaigns, unified lead inbox,
      AI insights, reports, connections
- [x] Meta connector: accounts, campaigns, daily insights, lead retrieval
- [x] AI modules: insight generation, lead scoring, copy studio (Claude,
      structured outputs)
- [ ] Meta OAuth connect flow (token exchange + encrypted storage)
- [ ] Sync pipeline wired end-to-end (connector → upserts → dashboard on live data)
- [ ] Provision Postgres (Neon) + first migration
- [ ] Deploy to Vercel + nightly cron
- [ ] Seed real workspaces: Alexia, FTS

## Phase 2 — Live data & client portal

- [ ] Replace demo dataset with per-workspace live queries
- [ ] Workspace switcher backed by DB + membership checks
- [ ] Client user invitations + restricted portal views
- [ ] Lead status pipeline with notes/activity log (replaces ops spreadsheets)
- [ ] AI lead scoring on sync for every new lead
- [ ] Daily AI insight job + email digest
- [ ] Google Ads connector

## Phase 3 — Differentiation

- [ ] "Ask your data" — natural-language analytics chat over live metrics
- [ ] Auto-generated branded PDF client reports
- [ ] WhatsApp alerts for critical anomalies
- [ ] AI Copy Studio UI (variants seeded from winning ads)
- [ ] Budget pacing & forecast (month-end projection vs target)
- [ ] TikTok / LinkedIn connectors
- [ ] Industry benchmarks across anonymized workspace data
