/**
 * Message templates — the placeholder language shared by the picker (client)
 * and the Settings editor. Pure functions, no DB.
 *
 * Syntax:
 *   {first_name}  {name}  {city}  {state}  {campaign}
 *   {agent_name}  {agent_phone}  {agent_email}
 *   {if city=Stockton}…{else}…{/if}   — city match, case-insensitive,
 *                                       "contains" so "Stockton, CA" works
 *
 * Unknown placeholders are left as-is so a typo shows up in the preview
 * instead of silently vanishing.
 */

export const TEMPLATE_CHANNELS = ["sms", "email"] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];

export const TEMPLATE_CHANNEL_LABEL: Record<TemplateChannel, string> = {
  sms: "SMS",
  email: "Email",
};

export function isTemplateChannel(v: unknown): v is TemplateChannel {
  return typeof v === "string" && (TEMPLATE_CHANNELS as readonly string[]).includes(v);
}

export interface TemplateVars {
  /** Lead's full name as stored. */
  name?: string | null;
  city?: string | null;
  state?: string | null;
  campaign?: string | null;
  agentName?: string | null;
  agentPhone?: string | null;
  agentEmail?: string | null;
}

/** What the Settings editor lists as available placeholders. */
export const TEMPLATE_PLACEHOLDERS: { token: string; hint: string }[] = [
  { token: "{first_name}", hint: "Lead's first name" },
  { token: "{name}", hint: "Lead's full name" },
  { token: "{city}", hint: "Lead's city (or the ad set's target city)" },
  { token: "{state}", hint: "Lead's state / region" },
  { token: "{campaign}", hint: "Campaign name" },
  { token: "{agent_name}", hint: "Your name" },
  { token: "{agent_phone}", hint: "Your RingCentral number" },
  { token: "{agent_email}", hint: "Your email" },
  { token: "{if city=Stockton}…{else}…{/if}", hint: "Different text for one city" },
];

/** Sample values for the Settings preview — a lead that looks real. */
export const SAMPLE_VARS: Required<TemplateVars> = {
  name: "John Smith",
  city: "San Jose",
  state: "CA",
  campaign: "Drivers – Bay Area",
  agentName: "Maria Lopez",
  agentPhone: "510 962-4394",
  agentEmail: "maria@example.com",
};

function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

/** "—" and other dash-only placeholders the UI uses for "no value". */
function clean(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  return t === "—" || t === "-" ? "" : t;
}

const COND_RE =
  /\{if\s+city\s*=\s*([^}]+?)\s*\}([\s\S]*?)(?:\{else\}([\s\S]*?))?\{\/if\}/gi;

/** Fills a template body (or subject) with the lead's and agent's values. */
export function renderTemplate(text: string, vars: TemplateVars): string {
  const city = clean(vars.city);
  // Conditionals first so their branches can themselves contain placeholders.
  let out = text.replace(COND_RE, (_m, wanted: string, yes: string, no?: string) =>
    city.toLowerCase().includes(wanted.trim().toLowerCase()) ? yes : (no ?? ""),
  );
  const map: Record<string, string> = {
    first_name: firstName(clean(vars.name)),
    name: clean(vars.name),
    city,
    state: clean(vars.state),
    campaign: clean(vars.campaign),
    agent_name: clean(vars.agentName),
    agent_phone: clean(vars.agentPhone),
    agent_email: clean(vars.agentEmail),
  };
  out = out.replace(/\{([a-z_]+)\}/g, (m, key: string) =>
    key in map ? map[key] : m,
  );
  // "Hi ," / "Hi !" when the lead has no name reads badly — close the gap.
  return out.replace(/[ \t]+([,!?.])/g, "$1").replace(/[ \t]{2,}/g, " ");
}

/** GSM-7 vs UCS-2 segment math, same as the carriers'. */
export function smsSegments(text: string): { chars: number; segments: number; unicode: boolean } {
  const chars = text.length;
  if (chars === 0) return { chars: 0, segments: 0, unicode: false };
  const unicode = /[^\x20-\x7E\n\r]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return { chars, unicode, segments: chars <= single ? 1 : Math.ceil(chars / multi) };
}

/** Pretty "+15109624394" → "510 962-4394" for signatures. */
export function formatPhoneForText(e164: string | null | undefined): string {
  const d = (e164 ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1"))
    return `${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6)}`;
  return (e164 ?? "").trim();
}
