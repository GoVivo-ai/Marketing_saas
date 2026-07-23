"use server";

import { auth } from "@/lib/auth";

export interface SupportTicketState {
  error?: string;
  success?: string;
}

const CATEGORIES = new Set([
  "access",
  "bug",
  "data",
  "performance",
  "integration",
  "feature_request",
  "other",
]);
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

/**
 * Files a support ticket with the Vivo Assistant on behalf of the signed-in
 * user (matched by email against the assistant's Slack roster). Follow-ups
 * and the resolution then arrive as Slack DMs, same as tickets opened in
 * chat.
 */
export async function createSupportTicket(
  _prev: SupportTicketState,
  formData: FormData,
): Promise<SupportTicketState> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "You must be signed in." };

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const rawCategory = String(formData.get("category") ?? "other");
  const rawPriority = String(formData.get("priority") ?? "medium");
  if (!title || !description)
    return { error: "Subject and description are required." };

  const key = process.env.VIVO_ASSISTANT_KEY;
  const base =
    process.env.VIVO_ASSISTANT_URL ?? "https://vivo-assistant.vercel.app";
  if (!key)
    return { error: "Support isn't configured yet (missing VIVO_ASSISTANT_KEY)." };

  try {
    const res = await fetch(`${base}/api/tickets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        title,
        description,
        category: CATEGORIES.has(rawCategory) ? rawCategory : "other",
        priority: PRIORITIES.has(rawPriority) ? rawPriority : "medium",
        lang: "es",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      number?: number;
      error?: string;
    };
    if (!res.ok) {
      return {
        error:
          data.error === "user_not_found"
            ? "Your email isn't linked to the Vivo Assistant yet — send it any Slack DM once and try again."
            : "Couldn't create the ticket. Please try again.",
      };
    }
    return {
      success: `Ticket #${data.number} created — you'll get updates by Slack DM.`,
    };
  } catch {
    return { error: "Couldn't reach the support service. Please try again." };
  }
}
