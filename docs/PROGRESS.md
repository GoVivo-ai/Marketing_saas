# Worklog — Vivo Marketing OS

> Running notes to pick up work day to day. Last updated: **2026-07-02**.

---

## Session 2026-07-02 — Security hardening + Contact Queue + Funnel report

No schema changes this session — everything runs on the existing tables.

### Security (full OWASP audit, findings fixed)

- **Sessions revocable**: JWT re-validated against the DB every 60s (deleted /
  demoted users lose access in ~1 min, was up to 30 days); `maxAge` cut to 24h.
- **Login**: rate limit 10 attempts / 15 min per email + dummy bcrypt compare
  (timing no longer reveals which emails exist); 72-byte password cap.
- **Security headers** in `next.config.ts`: CSP, HSTS, X-Frame-Options,
  nosniff, Referrer-Policy, Permissions-Policy (mic delegated to RingCentral).
  ⚠️ **Verify in prod**: dialer + Leaflet map under the new CSP.
- **Cron fixed**: route was POST-only but Vercel Cron calls GET — **the nightly
  sync never ran**. Now GET+POST with constant-time secret compare.
  ⚠️ Confirm `CRON_SECRET` is set in Vercel and the 6:00 run happens.
- AI insights route rate-limited (5/10min per user); SVG banned from logo
  uploads (stored XSS); lead-scoring prompt hardened against prompt injection;
  Dialpad numbers E.164-validated; dialer postMessage pinned to RC origin;
  `decryptSecret` validates payload shape; note length caps.
- Audit verdict overall: no SQLi/IDOR/secret leaks found; OAuth (PKCE+state)
  and AES-256-GCM token storage are solid. `next-auth` is still a beta —
  track releases. Rate limiter is in-memory (per-instance brake, not a quota).

### Contact Queue (`/leads/queue`) — the ops working view

- Ordered queue: overdue follow-ups first (oldest touch first), then new
  leads by AI score. Follow-up window: 2 days (`FOLLOW_UP_AFTER_DAYS`).
- Working card: score / area verdict with distance / prior touches / AI
  suggested action; Call & SMS fire the in-browser RingCentral dialer;
  one-click outcome chips log the touch and advance (~2 clicks per touch).
- **Terminal outcomes capture RCA inline** (pre-filled with the likely path);
  the lead detail's RCA form is now collapsed behind "Mark as lost…" / Edit.
- **Undo** (toast + "Worked this session" list): deletes the mis-logged touch
  (author-only, 15-min window) and walks back the auto-advance.
- **Ad-set filter** (`?adset=`) — "today I'm only working Redondo Beach".
- **Pipeline stays in sync**: answered/replied → advance to Contacted; RCA
  saved → lead moves to the Lost stage; clearing the reason walks it back.

### Reports — 4-stage funnel (the meeting's reporting-gap fix)

- Funnel counts how many leads **ever reached** each stage (current stage +
  `status_change` history), so lost leads still count where they got to —
  leads count from entry, not only after completing Contractor Compliance.
- Stage-to-stage conversion + % of total + date-range picker; side card with
  top RCA loss reasons and the unclassified count.
- To match the meeting's naming, rename stages in the stage editor:
  `Qualified` → "Contractor Compliance", `Won` → "Contratado".

### Also

- Committed the pending RingCentral in-browser dialer work (widget, sync-now
  button, Meta ad-set↔city matching).
- `docs/LEGACY-LEADS-IMPORT.md`: full analysis of the ops master Excel
  (4,286 leads) → schema mapping + normalizer design. **Decision: no data
  import** — the Excel is reference for workflow design only.

### Next up (agreed priority)

1. **Manual lead capture** — "Add lead" form with source (Gmail / Craigslist /
   Web / Referral / Inbound call) + vehicle fields; needs the `leads.source`
   column from the analysis doc. Last blocker to fully retiring the Excel.
2. **SMS/email templates** with variables, prefilling the dialer composer.
3. **Automated follow-up sequences** (rules engine on the nightly cron;
   needs an outbound email provider — none exists yet).
4. CC/Everdriven integration — blocked on their access.
5. Human tasks: rename stages per Felipe/Juan Pablo's criteria; create
   Pablo's & Alirio's users so queue attribution is theirs.

### New prod env vars

`CRON_SECRET` (cron auth — sync silently 401s without it).

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
