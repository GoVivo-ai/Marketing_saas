import { getSecret } from "@/lib/settings";

/**
 * AlexYah's driver-application portal.
 *
 * The client had a third party build a hiring portal, and its applications
 * never reached MarTech — 374 of them by the time we got access, invisible to
 * the team working the pipeline. This is the read-only integration endpoint
 * their developer opened for us: applicants plus the state of each required
 * document, paginated, behind a service API key.
 *
 * Read-only by design on their side. Files are deliberately not exposed; the
 * response says how many a document has, not where they live.
 */

const BASE = "https://www.alexyah.com/api/integrations";
/** Their documented ceiling. */
const MAX_LIMIT = 500;
/** 60 requests/min per IP — stay well inside it. */
const PAGE_PAUSE_MS = 250;

export class AlexYahError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AlexYahError";
  }
}

export class AlexYahNotConfiguredError extends AlexYahError {
  constructor() {
    super("No AlexYah API key configured");
    this.name = "AlexYahNotConfiguredError";
  }
}

/** One required document and how far along it is. */
export interface AlexYahDocument {
  key: string;
  label: string;
  /** idle = not requested yet · requested · overdue · received. */
  state: "idle" | "requested" | "overdue" | "received" | string;
  expiry: string | null;
  /** How many files were uploaded; the files themselves are not exposed. */
  files: number;
}

export interface AlexYahApplication {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  /** new · reviewing · interview · background · approved · rejected. */
  stage: string;
  status: string | null;
  /** Their own channel label, e.g. "Website". */
  source: string | null;
  appliedAt: string | null;
  interviewAt: string | null;
  lastContactAt: string | null;
  documents: AlexYahDocument[];
}

interface ApiPage {
  total: number;
  count: number;
  limit: number;
  offset: number;
  applications: {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    city?: string | null;
    state?: string | null;
    stage?: string;
    status?: string | null;
    source?: string | null;
    applied_at?: string | null;
    interview_at?: string | null;
    last_contact_at?: string | null;
    documents?: {
      key?: string;
      label?: string;
      state?: string;
      expiry?: string | null;
      files?: number;
    }[];
  }[];
}

export async function isAlexYahConfigured(): Promise<boolean> {
  return Boolean(await getSecret("alexyah_api_key"));
}

async function getPage(
  apiKey: string,
  limit: number,
  offset: number,
): Promise<ApiPage> {
  const res = await fetch(
    `${BASE}/driver-applications?limit=${limit}&offset=${offset}`,
    { headers: { "x-api-key": apiKey }, cache: "no-store" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    // Their codes: 401 bad key, 429 rate limited, 503 key missing on their side.
    const hint =
      res.status === 401
        ? "the API key was rejected"
        : res.status === 429
          ? "rate limited (60/min per IP)"
          : res.status === 503
            ? "AlexYah has not set INTEGRATIONS_API_KEY on their side"
            : (body?.error ?? "unexpected response");
    throw new AlexYahError(`AlexYah ${res.status}: ${hint}`, res.status);
  }
  return (await res.json()) as ApiPage;
}

const normalize = (a: ApiPage["applications"][number]): AlexYahApplication => ({
  id: a.id,
  firstName: a.first_name ?? null,
  lastName: a.last_name ?? null,
  email: a.email ?? null,
  phone: a.phone ?? null,
  city: a.city ?? null,
  state: a.state ?? null,
  stage: a.stage ?? "new",
  status: a.status ?? null,
  source: a.source ?? null,
  appliedAt: a.applied_at ?? null,
  interviewAt: a.interview_at ?? null,
  lastContactAt: a.last_contact_at ?? null,
  documents: (a.documents ?? []).map((d) => ({
    key: d.key ?? "",
    label: d.label ?? d.key ?? "",
    state: d.state ?? "idle",
    expiry: d.expiry ?? null,
    files: d.files ?? 0,
  })),
});

/**
 * Every driver application, following their `offset + count >= total` rule.
 * Paused briefly between pages so a full backfill never trips their rate
 * limit and gets us locked out of the client's own system.
 */
export async function fetchDriverApplications(opts: { limit?: number } = {}): Promise<
  AlexYahApplication[]
> {
  const apiKey = await getSecret("alexyah_api_key");
  if (!apiKey) throw new AlexYahNotConfiguredError();

  const limit = Math.min(opts.limit ?? MAX_LIMIT, MAX_LIMIT);
  const out: AlexYahApplication[] = [];
  let offset = 0;

  for (let page = 0; page < 100; page++) {
    const data = await getPage(apiKey, limit, offset);
    out.push(...(data.applications ?? []).map(normalize));
    offset += data.count;
    if (data.count === 0 || offset >= data.total) break;
    await new Promise((r) => setTimeout(r, PAGE_PAUSE_MS));
  }
  return out;
}
