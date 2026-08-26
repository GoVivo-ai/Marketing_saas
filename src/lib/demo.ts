import { auth } from "@/lib/auth";

/**
 * Demo mode — a shareable, self-signing-in tour of the platform.
 *
 * The /demo link logs visitors in as a dedicated read-mostly user whose only
 * membership is the "demo" workspace, seeded with anonymized copies of real
 * data (scripts/seed-demo.ts). Visitors can play with leads and the pipeline
 * (re-seeding resets everything), but configuration, credentials, org
 * management and outbound messaging are blocked via isDemoSession() guards.
 */
export const DEMO_EMAIL = "demo@govivo.ai";
export const DEMO_WORKSPACE_SLUG = "demo";

export const DEMO_BLOCKED_MSG =
  "Demo mode: this action is disabled. Book a call with Vivo to see it live.";

export const isDemoEmail = (email: string | null | undefined) =>
  (email ?? "").toLowerCase().trim() === DEMO_EMAIL;

/** True when the current session belongs to the demo tour user. */
export async function isDemoSession(): Promise<boolean> {
  const session = await auth();
  return isDemoEmail(session?.user?.email);
}

/** Guard for actions that throw on failure (form actions without state). */
export async function assertNotDemo(): Promise<void> {
  if (await isDemoSession()) throw new Error(DEMO_BLOCKED_MSG);
}
