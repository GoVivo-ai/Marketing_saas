import { NextRequest } from "next/server";
import { signIn } from "@/lib/auth";

/**
 * Shareable demo link: GET /demo (or /demo?key=… when DEMO_ACCESS_KEY is set)
 * signs the visitor in as the demo user and drops them on the dashboard.
 * Seed the demo workspace first: npx tsx scripts/seed-demo.ts
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  // Throws NEXT_REDIRECT to /dashboard on success, or back to /login with
  // error=CredentialsSignin when the key is wrong / the demo isn't seeded.
  await signIn("demo", { key, redirectTo: "/dashboard" });
}
