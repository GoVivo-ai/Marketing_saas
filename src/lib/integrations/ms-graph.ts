/**
 * Minimal Microsoft Graph client for the dispatch module — client-credentials
 * token (cached per app until near expiry) + SharePoint list reads. No SDK.
 *
 * Credentials are per workspace (dispatch_connections, secret encrypted);
 * the MS_* / SHAREPOINT_* env vars remain as a dev-only fallback. Each
 * client registers its own Entra app holding only `Sites.Selected`, granted
 * to a single site by their admin (one-time POST /sites/{id}/permissions —
 * see scripts/sync-dispatch-interactions.ts).
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";

const GRAPH = "https://graph.microsoft.com/v1.0";

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  siteUrl: string;
  /** SharePoint list id (preferred) or display name. */
  listName: string;
}

/** Workspace's Graph connection: DB row first, env fallback for dev. */
export async function getGraphConfig(
  workspaceId: string,
): Promise<GraphConfig | null> {
  const [row] = await db()
    .select()
    .from(schema.dispatchConnections)
    .where(eq(schema.dispatchConnections.workspaceId, workspaceId))
    .limit(1);
  if (row) {
    try {
      return {
        tenantId: row.tenantId,
        clientId: row.clientId,
        clientSecret: decryptSecret(row.clientSecretEnc),
        siteUrl: row.siteUrl,
        listName: row.listName,
      };
    } catch {
      return null; // encryption key rotated — treat as unconfigured
    }
  }
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, SHAREPOINT_SITE_URL } =
    process.env;
  if (MS_TENANT_ID && MS_CLIENT_ID && MS_GRAPH_CLIENT_SECRET && SHAREPOINT_SITE_URL) {
    return {
      tenantId: MS_TENANT_ID,
      clientId: MS_CLIENT_ID,
      clientSecret: MS_GRAPH_CLIENT_SECRET,
      siteUrl: SHAREPOINT_SITE_URL,
      listName: process.env.SHAREPOINT_LIST_NAME ?? "Alexyah's Interactions",
    };
  }
  return null;
}

export async function isGraphConfigured(workspaceId: string): Promise<boolean> {
  return (await getGraphConfig(workspaceId)) !== null;
}

// One token per Entra app — several workspaces may share nothing.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(cfg: GraphConfig): Promise<string> {
  const key = `${cfg.tenantId}:${cfg.clientId}`;
  const cached = tokenCache.get(key);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const res = await fetch(
    `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );
  if (!res.ok)
    throw new Error(`Graph token failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(key, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

async function graphGet<T>(cfg: GraphConfig, path: string): Promise<T> {
  const token = await accessToken(cfg);
  const url = path.startsWith("https://") ? path : `${GRAPH}${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok)
    throw new Error(`Graph GET ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Graph site id for the config's site URL (hostname + server-relative path). */
export async function getSiteId(cfg: GraphConfig): Promise<string> {
  const u = new URL(cfg.siteUrl);
  const path = u.pathname.replace(/\/$/, "");
  const site = await graphGet<{ id: string }>(
    cfg,
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
 * All items of the config's list, fields expanded, following
 * @odata.nextLink pagination.
 */
export async function readListItems(cfg: GraphConfig): Promise<SpListItem[]> {
  const siteId = await getSiteId(cfg);
  const items: SpListItem[] = [];
  let url: string | null =
    `${GRAPH}/sites/${siteId}/lists/${encodeURIComponent(cfg.listName)}/items?expand=fields&$top=200`;
  while (url) {
    const page: { value: SpListItem[]; "@odata.nextLink"?: string } =
      await graphGet(cfg, url);
    items.push(...page.value);
    url = page["@odata.nextLink"] ?? null;
  }
  return items;
}
