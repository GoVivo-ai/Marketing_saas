# Architecture

## Overview

```
┌────────────────────────────────────────────────────────────┐
│                        Next.js 16 (Vercel)                 │
│                                                            │
│  RSC pages (dashboard, leads…)      API routes             │
│  ─ per-workspace data access        ─ /api/auth/*          │
│  ─ role-aware UI                    ─ /api/ai/insights     │
│                                     ─ /api/cron/sync       │
└──────────────┬─────────────────────────────┬───────────────┘
               │                             │
        ┌──────▼──────┐               ┌──────▼───────────────┐
        │  PostgreSQL │               │  Connectors           │
        │  (Drizzle)  │◄── upserts ───│  meta.ts (Graph API)  │
        │             │               │  google-ads.ts (P2)   │
        └──────┬──────┘               └──────────────────────┘
               │
        ┌──────▼──────────────────────────────┐
        │  AI layer (Vercel AI SDK + Claude)  │
        │  insights · lead scoring · copy     │
        └─────────────────────────────────────┘
```

## Multi-tenancy

The tenancy boundary is the **workspace** (one per Vivo client). Every data
table carries `workspace_id` and every query must filter by it. Access control:

| Role | Scope |
| --- | --- |
| `agency_admin` | All workspaces, full write |
| `agency_member` | Workspaces where they are a member |
| `client` | Only their workspace(s), viewer-oriented UI |

Per-workspace roles (`owner` / `editor` / `viewer`) refine permissions inside a
workspace via `workspace_members`.

**Rule: no query without a workspace filter.** Data-access helpers should take
the session + workspace id and enforce membership before touching tables.

## Data flow

1. **Connect** — an agency user links a platform account to a workspace via
   OAuth. Tokens are encrypted (AES-256-GCM with `TOKEN_ENCRYPTION_KEY`) and
   stored in `connections`.
2. **Sync** — Vercel Cron hits `/api/cron/sync` nightly (plus on-demand). For
   each active connection the platform connector pulls campaigns, daily
   metrics and leads, normalized to the shapes in
   `src/lib/integrations/types.ts`, and upserts them (idempotent on
   external ids + dates).
3. **Score** — each new lead passes through AI lead scoring (Claude Haiku —
   cheap, fast) and lands in the unified inbox pre-prioritized.
4. **Analyze** — a daily job aggregates week-over-week metrics per workspace
   and asks Claude Sonnet for anomalies/recommendations (structured output,
   Zod-validated). Results persist to `ai_insights`.
5. **Report** — periodic jobs write executive summaries to `reports` and (later)
   render branded PDFs / send digests.

## Why this stack

- **Postgres over a warehouse**: at agency scale (dozens of clients, daily
  granularity) Postgres handles years of metrics trivially; a warehouse can be
  added later behind the same normalized shapes.
- **Drizzle over Prisma**: lighter runtime, plain-SQL mental model, fast cold
  starts on serverless.
- **Connector pattern**: each platform is ~1 file implementing a 4-method
  interface. Adding TikTok touches zero product code.
- **Structured AI outputs**: every AI feature uses `generateObject` with a Zod
  schema — no free-text parsing, retries handled by the SDK.

## Security notes

- Platform tokens encrypted at rest; never sent to the client.
- `/api/cron/sync` requires `Authorization: Bearer $CRON_SECRET`.
- Sessions are JWT (Auth.js); role + user id embedded and re-checked server-side.
- The demo credentials provider is disabled in production builds when a
  database is configured.
- Client users can never enumerate other workspaces: queries join through
  `workspace_members`.
