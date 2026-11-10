import type { NextRequest } from "next/server";
import { handleMobile } from "@/lib/mobile/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return handleMobile(req, (await ctx.params).path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return handleMobile(req, (await ctx.params).path);
}
