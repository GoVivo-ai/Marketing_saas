# Worklog — Vivo Marketing OS

> Running notes to pick up work day to day. Last updated: **2026-06-12**.

## Git workflow (important)

- Work on **`develop`**, then PR + merge to **`main`** (prod auto-deploys on Vercel).
- ⚠️ This machine has **multiple GitHub accounts** in `gh`. Only **`VictorSandovalDev`**
  has push access to `GoVivo-ai/Marketing_saas`. If push is denied (403 to another
  user), run `gh auth switch -u VictorSandovalDev` and push with the gh token:
  `git push "https://x-access-token:$(gh auth token)@github.com/GoVivo-ai/Marketing_saas.git" develop`
- Commits/PRs: **no "Co-Authored-By: Claude"**. All code/UI/comments in **English**.

## Database

- **Supabase Postgres** (`aws-1-us-east-2.pooler.supabase.com`), connection in `.env.local`.
- All migrations below already applied to that DB. **If prod Vercel uses the same
  Supabase, prod is up to date.** If it uses a different DB, run the migrations there.
- Migrations are plain idempotent scripts (drizzle-kit push is broken here):
  `npx tsx scripts/migrate-*.ts`

### Migrations added this session

| Script | Adds |
|---|---|
| `migrate-adsets.ts` | `adsets`, `adset_metrics_daily` |
| `migrate-planner.ts` | `monthly_plans` |
| `migrate-planner-cities.ts` | `plan_city_targets`, `workspaces.result_label` |
| `migrate-planner-period.ts` | `monthly_plans.period_start` / `period_end` |
| `migrate-lead-geo.ts` | `leads.adset_id/geo_city/geo_lat/geo_lng`, `geocache` |

### Prod env vars required

`AUTH_SECRET`, `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `META_ACCESS_TOKEN`
(+ `NEXT_PUBLIC_APP_URL`, and Dialpad/RingCentral when those go live).
`TOKEN_ENCRYPTION_KEY` **must match** the key that encrypted tokens in that env's DB.

---

## Shipped this session (PRs #14–#29)

### Bug fixes
- **Meta leads doubled** — was summing `lead` + `onsite_conversion.lead_grouped`
  (same lead twice). Now uses `lead` (fallback to grouped). Re-synced AlexYah & FTS.
  ⚠️ Only the synced windows were corrected; older months need a re-sync if needed.
- **404 when switching client on a campaign detail page** — switcher routes to
  `/campaigns`, and the detail page redirects there instead of 404.
- **Page crash with Google Translate** — guarded `removeChild`/`insertBefore` in the
  root layout (Translate swaps text nodes, breaking React on re-render).
- **Stale client data after switching** — page content is keyed by workspace so it
  remounts (client components no longer keep the previous client's state).

### Campaigns
- **Drill-down by city**: click a campaign → `/campaigns/[id]` with an interactive
  **Leaflet radius map** of each ad set's audience location + targeting radius.
- Date filter (7/30/90/custom), **active/paused** ad-set filter, aligned rows.

### Leads
- **In / near (≤1.5× radius) / outside** the targeted audience radius, shown in the
  lead detail panel. Lead city geocoded (OSM, cached in `geocache`); lead attributed
  to its ad set via Meta `adset_id`. ~57% of leads have a `city` field.

### Pipeline
- Drag activation lowered to **10ms** (near-instant; click still opens the lead).

### Planner (Excel-style, generic) — the big one
- **Per-client result label** (Sales / Hires / Appointments…) set in Settings.
- **By-city plan**: CPL + conversion are global assumptions; per-city **goal** auto-sizes
  leads & budget; totals feed the budget hero, funnel and comparison.
- **User-chosen cities**: add/remove any city (synced ad-set cities pre-fill with actuals).
- **Pacing**: days elapsed/left, spend & leads per day, leads/day to hit goal, projection.
- **Operations funnel**: pipeline stages with the period's lead counts.
- **Flexible campaign period** (start/end) overrides the calendar month.
- **Plan vs actual** scoped to the **planned cities** (like-for-like).
- Save / delete plan, month navigation, **saved-plans history** table.
- Interactive **funnel chart** + budget pacing hero.

### Other
- **Per-client brand logo** (Settings → Brand logo), shown white next to the Vivo logo
  (enlarged so it's visible).
- **Professional README** with badges + login/dashboard screenshots, "By VictorSandovalDev".

---

## Integrations — what the CLIENT must still do (code is ready)

### Dialpad (per-user OAuth, external clients)
1. Register an **OAuth app** at developers.dialpad.com → get `CLIENT_ID`/`CLIENT_SECRET`.
2. Redirect URI: `https://TU-DOMINIO/api/dialpad/callback`.
3. Get **scopes approved** (call + SMS).
4. **App Marketplace submission** so external companies can connect.
5. Env: `DIALPAD_CLIENT_ID/SECRET`, `DIALPAD_SERVER_URL=https://dialpad.com`.

### RingCentral (per-user OAuth + PKCE, external clients)
- Code already implements Auth Code + PKCE correctly.
1. Create a **confidential (server) OAuth app** with **Authorization Code** grant
   (NOT a client-side/SPA app — code uses the client secret).
2. Redirect URI: `https://TU-DOMINIO/api/ringcentral/callback`.
3. Scopes: **RingOut, SMS, ReadAccounts**.
4. App must be **Public** and **graduated to Production** for external users.
5. Env: `RINGCENTRAL_CLIENT_ID/SECRET`, `RINGCENTRAL_SERVER_URL=https://platform.ringcentral.com`.

---

## Operational notes

- **Re-sync to populate new data**: `npm run sync` (or `npm run sync -- <slug> <days>`).
  First sync per account is **slow** (geocodes each unique city ~1.1s, OSM rate limit);
  after that it's cached and fast. AlexYah done. **FTS / other accounts still need a first
  re-sync** to populate ad-set attribution + lead geo.

---

## ⏭ TOMORROW — Lead radius for ALL clients (old + new)

The radius needs **two things per lead**: (1) the lead's own city (from the form)
and (2) Meta-provided ad-set attribution (gives the target city + radius).

**FTS findings (2026-06-12):**
- 17/22 FTS ad sets are city-targeted (Worcester, Framingham, Brockton… MA/AZ) ✓
- FTS leads split in two, each missing one piece:
  - **170 recent** = attributed to their ad set, but the recruitment form has **no
    city field** (asks "which areas are you willing to work in?") → no lead location.
  - **485 (May 11–Jun 10)** = have a `city` field, but come from **archived/deleted
    ads**, so the per-ad sync route doesn't re-attribute them → no target ad set.
- So FTS can't show the radius for most leads yet. **Not a code bug — a data gap.**

**The fix (do this):** backfill attribution by querying each existing lead **directly
by its Meta lead id** for `adset_id` (`GET /{lead_id}?fields=adset_id,campaign_id`) —
this works even when the ad is archived/deleted, unlike the current `/{ad}/leads`
route. Then geocode the lead's stored city. Run it across all workspaces so **old
leads** get covered too. Going forward, new synced leads already get both pieces.
- ⚠️ Heuristic attribution by matching the lead's city to an ad-set city is **wrong**
  (it would make every lead "within radius"). Attribution must come from Meta.
- Recruitment-style forms with no city field (some FTS leads) simply can't show a
  radius — that's a form-design limitation on the client side.

## Ideas / next up (not started)

- Planner: optionally show a **global total** alongside the planned-cities total.
- Planner: per-city **pacing** / daily lead distribution (Excel had day-by-day).
- Correct **older months** of doubled leads via a full historical re-sync if needed.
- Consider **Vercel Blob** for logos if large logos are wanted (currently stored as
  data URLs, capped 256 KB, ride in the layout payload).
