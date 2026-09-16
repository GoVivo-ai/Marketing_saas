import { NextResponse } from "next/server";
import {
  RingCentralNotConnectedError,
  sipProvision,
} from "@/lib/integrations/ringcentral";
import { currentUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Hands the browser the SIP credentials its softphone registers with.
 *
 * The OAuth tokens stay on the server — the browser never sees them. These
 * credentials are narrower: they authorize one registration for the calling
 * user's own extension and nothing else, and RingCentral issues them fresh on
 * every request, so there is nothing here worth caching or storing.
 *
 * POST because each call provisions a registration; it is not a read.
 */
export async function POST() {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const sip = await sipProvision(u.id);
    return NextResponse.json(sip, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof RingCentralNotConnectedError) {
      return NextResponse.json(
        { error: "RingCentral is not connected for this user" },
        { status: 409 },
      );
    }
    console.error("[sip-provision]", err);
    return NextResponse.json(
      { error: "Could not provision a softphone registration" },
      { status: 502 },
    );
  }
}
