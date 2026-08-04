/**
 * Minimal Microsoft Graph client for the dispatch module — client-credentials
 * token (cached until near expiry) + SharePoint list reads. No SDK.
 *
 *   MS_TENANT_ID             Entra tenant id (Alexyah Transportation LLC)
 *   MS_CLIENT_ID             the "Vivo Martech - Dispatch" app registration
 *   MS_GRAPH_CLIENT_SECRET   its client secret (Sensitive env)
 *   SHAREPOINT_SITE_URL      e.g. https://alexyah.sharepoint.com/sites/Ops
 *
 * The app holds only `Sites.Selected`, so it sees nothing until an admin
 * grants it permission on the specific site (one-time POST /sites/{id}/permissions
 * from Graph Explorer with an admin session — see scripts/sync-dispatch-interactions.ts).
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

let cachedToken: { token: string; expiresAt: number } | null = null;

export function isGraphConfigured(): boolean {
  return Boolean(
    process.env.MS_TENANT_ID &&
      process.env.MS_CLIENT_ID &&
      process.env.MS_GRAPH_CLIENT_SECRET &&
      process.env.SHAREPOINT_SITE_URL,
  );
}

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000)
    return cachedToken.token;
  const tenant = process.env.MS_TENANT_ID;
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.MS_CLIENT_ID ?? "",
        client_secret: process.env.MS_GRAPH_CLIENT_SECRET ?? "",
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );
  if (!res.ok)
    throw new Error(`Graph token failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

async function graphGet<T>(path: string): Promise<T> {
  const token = await accessToken();
  const url = path.startsWith("https://") ? path : `${GRAPH}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok)
    throw new Error(`Graph GET ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Graph site id for SHAREPOINT_SITE_URL (hostname + server-relative path). */
export async function getSiteId(): Promise<string> {
  const raw = process.env.SHAREPOINT_SITE_URL;
  if (!raw) throw new Error("SHAREPOINT_SITE_URL not set");
  const u = new URL(raw);
  const path = u.pathname.replace(/\/$/, "");
  const site = await graphGet<{ id: string }>(
    `/sites/${u.hostname}:${path || "/"}`,
  );
  return site.id;
}

export interface SpListItem {
  id: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  createdBy?: { user?: { displayName?: string } };
  lastModifiedBy?: { user?: { displayName?: string } };
  fields: Record<string, unknown>;
}

/**
 * All items of a list (by display name), fields expanded, following
 * @odata.nextLink pagination.
 */
export async function readListItems(listName: string): Promise<SpListItem[]> {
  const siteId = await getSiteId();
  const items: SpListItem[] = [];
  let url: string | null =
    `${GRAPH}/sites/${siteId}/lists/${encodeURIComponent(listName)}/items?expand=fields&$top=200`;
  while (url) {
    const page: { value: SpListItem[]; "@odata.nextLink"?: string } =
      await graphGet(url);
    items.push(...page.value);
    url = page["@odata.nextLink"] ?? null;
  }
  return items;
}
