import {
  getRingCentralTokens,
  getDialpadTokens,
  isRingCentralConnected,
  isDialpadConnected,
} from "@/lib/settings";
import * as rc from "./ringcentral";
import * as dp from "./dialpad";

/**
 * Provider-agnostic telephony router. A user can self-connect RingCentral
 * and/or Dialpad; click-to-call and SMS go through whichever is active. When
 * both are connected, the most recently connected one wins.
 */

export type TelephonyProvider = "ringcentral" | "dialpad";

export class NoProviderConnectedError extends Error {
  constructor() {
    super("No calling provider is connected");
    this.name = "NoProviderConnectedError";
  }
}

// Shared phone helper — E.164 validation is the same for every provider.
export { normalizeE164, BadPhoneError } from "./ringcentral";

export async function isAnyTelephonyConnected(userId: string): Promise<boolean> {
  const [rcOn, dpOn] = await Promise.all([
    isRingCentralConnected(userId),
    isDialpadConnected(userId),
  ]);
  return rcOn || dpOn;
}

/** Which provider a call/SMS should use right now, if any. */
export async function getActiveProvider(
  userId: string,
): Promise<TelephonyProvider | null> {
  const [rcOn, dpOn] = await Promise.all([
    isRingCentralConnected(userId),
    isDialpadConnected(userId),
  ]);
  if (rcOn && dpOn) {
    const [rcT, dpT] = await Promise.all([
      getRingCentralTokens(userId),
      getDialpadTokens(userId),
    ]);
    const rcAt = rcT?.connectedAt?.getTime() ?? 0;
    const dpAt = dpT?.connectedAt?.getTime() ?? 0;
    return dpAt >= rcAt ? "dialpad" : "ringcentral";
  }
  if (dpOn) return "dialpad";
  if (rcOn) return "ringcentral";
  return null;
}

function asNotConnected(err: unknown): never {
  if (
    err instanceof rc.RingCentralNotConnectedError ||
    err instanceof dp.DialpadNotConnectedError
  ) {
    throw new NoProviderConnectedError();
  }
  throw err;
}

export async function placeCall(
  userId: string,
  to: string,
): Promise<{ id: string; via: TelephonyProvider }> {
  const provider = await getActiveProvider(userId);
  if (!provider) throw new NoProviderConnectedError();
  try {
    if (provider === "dialpad") {
      const r = await dp.placeCall(userId, to);
      return { id: r.id, via: "dialpad" };
    }
    const r = await rc.ringOut(userId, to);
    return { id: String(r.id), via: "ringcentral" };
  } catch (err) {
    asNotConnected(err);
  }
}

export async function sendText(
  userId: string,
  to: string,
  text: string,
): Promise<{ id: string; via: TelephonyProvider }> {
  const provider = await getActiveProvider(userId);
  if (!provider) throw new NoProviderConnectedError();
  try {
    if (provider === "dialpad") {
      const r = await dp.sendSms(userId, to, text);
      return { id: r.id, via: "dialpad" };
    }
    const r = await rc.sendSms(userId, to, text);
    return { id: String(r.id), via: "ringcentral" };
  } catch (err) {
    asNotConnected(err);
  }
}
