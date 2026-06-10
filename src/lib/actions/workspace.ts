"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

const COOKIE = "ws";

/** Persists the active workspace (by slug) for the current user session. */
export async function setActiveWorkspace(slug: string) {
  const store = await cookies();
  store.set(COOKIE, slug, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
