# MarTech By Vivo

Multi-client marketing intelligence platform by **GoVivo.ai**.

One place where the agency and its clients see ad performance across platforms,
manage every lead without duplicated spreadsheets, and get AI-generated insights
before anyone has to ask for a report.

## Why this exists

Today, reporting is manual: ad spend and performance are copied from Meta into a
master Excel sheet per client, and leads land in a Google Sheet that operations
teams duplicate to add their own notes. This platform replaces that workflow with:

- **Live dashboards** connected directly to the ad platforms' APIs
- **A unified lead inbox** shared by marketing and operations — one source of truth
- **AI that does the analyst work**: anomaly detection, scaling recommendations,
  lead scoring and auto-written client reports

## Differentiators (what wins clients)

| Feature | What the client experiences |
| --- | --- |
| **Client portal** | Their own branded login with live numbers — radical transparency vs. a monthly PDF |
| **AI Analyst** | Daily insights citing real numbers: "Dallas CPL up 18%, creative fatigue, rotate videos" |
| **AI Lead Scoring** | Every lead arrives pre-scored 0–100 with a reason — sales calls the best ones first |
| **Unified Lead Inbox** | Marketing attribution + operations follow-up in one place, no duplicated sheets |
| **AI Copy Studio** | New ad variants seeded with the account's actual winning ads, not generic templates |
| **Proactive alerts** | CPL jumps and tracking outages pushed to WhatsApp/email the moment they happen |

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js 16** (App Router, RSC, Turbopack) | One codebase for portal + API, first-class Vercel deploys |
| Language | **TypeScript** end-to-end | Safety across DB → API → UI |
| UI | **Tailwind CSS v4 + shadcn/ui + Recharts** | Professional dashboard UI, fast iteration |
| Database | **PostgreSQL + Drizzle ORM** | Relational fits campaign/metrics data; typed schema & migrations |
| Auth | **Auth.js v5** | Role-based access: agency vs. per-workspace client users |
| AI | **Vercel AI SDK + Anthropic Claude** | Structured outputs (Zod-validated) for insights, scoring, copy |
| Integrations | **Connector pattern** (`src/lib/integrations`) | Meta first; Google Ads, TikTok, LinkedIn plug into the same interface |
| Jobs | **Vercel Cron → `/api/cron/sync`** | Nightly sync of campaigns, metrics and leads per connection |
| Hosting | **Vercel** | Zero-ops, preview deploys, edge network |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in AUTH_SECRET at minimum
npm run dev
```

Set `DATABASE_URL` in `.env.local`, then create the schema and the initial
workspaces/admin user:

```bash
npx drizzle-kit push
npm run db:seed
```

Open http://localhost:3000 and sign in with the seeded admin account.

### Useful scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npx drizzle-kit studio` | Browse the database |

## Project structure

```
src/
  app/
    (app)/            # Authenticated product: dashboard, campaigns, leads,
                      # insights, reports, settings
    api/
      auth/           # Auth.js handlers
      ai/insights/    # On-demand AI insight generation
      cron/sync/      # Nightly platform sync (Vercel Cron)
    login/            # Sign-in
  components/
    app/              # Product components (sidebar, KPI cards, charts)
    ui/               # shadcn/ui primitives
  lib/
    ai/               # Claude-powered: insights, lead scoring, copy studio
    db/               # Drizzle schema + client (multi-tenant by workspace)
    integrations/     # Platform connectors (Meta live, Google Ads next)
docs/
  ARCHITECTURE.md     # Tenancy model, data flow, security
  ROADMAP.md          # Phased delivery plan
```

## Multi-tenancy model

Every client of Vivo (Alexia, FTS, Vectora…) is a **workspace**. All marketing
data — connections, campaigns, metrics, leads, insights — is scoped to exactly
one workspace. Access:

- `agency_admin` / `agency_member` (Vivo team): all / assigned workspaces
- `client` users: only the workspaces they are members of, viewer-oriented UI

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Status

Phase 1 foundation. See [docs/ROADMAP.md](docs/ROADMAP.md) for the delivery plan.
