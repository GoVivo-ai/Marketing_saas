-- Clickwrap proof for the Platform Terms (legal v1, B11). Mirrors
-- termsAcceptances in src/lib/db/schema.ts. Must exist BEFORE deploying the
-- code that gates the app on it, or every page load fails.
create table if not exists terms_acceptances (
  id          text primary key,
  user_id     text not null,
  email       text not null,
  version     text not null,
  ip_address  text,
  user_agent  text,
  accepted_at timestamp not null default now()
);
create unique index if not exists terms_acceptances_user_version_idx
  on terms_acceptances (user_id, version);
