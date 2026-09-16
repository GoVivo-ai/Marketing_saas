"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type WebPhone from "ringcentral-web-phone";
import type CallSession from "ringcentral-web-phone/call-session/index";
import type InboundCallSession from "ringcentral-web-phone/call-session/inbound";

/**
 * The browser softphone: a real SIP registration over WebRTC, in our own UI,
 * instead of RingCentral's embedded widget in an iframe.
 *
 * Why not the widget: it owns its own call state inside a cross-origin frame,
 * so the product can only shout at it through postMessage and can never know
 * what actually happened on a call. Everything the reports need — that a call
 * connected, how long it really lasted — arrives second-hand and lossy. A
 * registration we own reports its own truth.
 *
 * RingCentral allows one registration per extension: whoever registers last
 * wins and the previous one goes deaf. So this and the embedded widget must
 * never run at the same time.
 */

export type SoftphoneStatus =
  | "unconfigured"
  | "connecting"
  | "registered"
  | "failed";

export type CallState = "ringing" | "answered" | "ended" | "failed";

export interface ActiveCall {
  id: string;
  direction: "inbound" | "outbound";
  /** The other party's number, as RingCentral reports it. */
  remoteNumber: string;
  /** Caller ID name on inbound calls, when the carrier sends one. */
  remoteName: string | null;
  state: CallState;
  muted: boolean;
  held: boolean;
  /** When the call was answered — the basis for the on-screen timer. */
  answeredAt: number | null;
  startedAt: number;
}

interface SipProvision {
  domain: string;
  outboundProxy: string;
  outboundProxyBackup: string;
  username: string;
  authorizationId: string;
  password: string;
  stunServers: string[];
  extensionNumber: string | null;
}

export interface Softphone {
  status: SoftphoneStatus;
  error: string | null;
  extensionNumber: string | null;
  call: ActiveCall | null;
  /** Places a call and resolves once RingCentral has accepted the invite. */
  dial: (number: string) => Promise<void>;
  answer: () => Promise<void>;
  decline: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
  toggleHold: () => Promise<void>;
  sendDtmf: (tones: string) => void;
  transfer: (target: string) => Promise<void>;
  /** Retries registration after a failure, without a page reload. */
  reconnect: () => void;
}

/** A call is worth reporting once it is over; before that it can still change. */
async function reportCall(call: ActiveCall, endedAt: number) {
  try {
    await fetch("/api/ringcentral/softphone-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callId: call.id,
        direction: call.direction,
        remoteNumber: call.remoteNumber,
        startedAt: new Date(call.startedAt).toISOString(),
        answeredAt: call.answeredAt ? new Date(call.answeredAt).toISOString() : null,
        endedAt: new Date(endedAt).toISOString(),
        state: call.state,
      }),
      keepalive: true,
    });
  } catch {
    // The nightly RingCentral sync is the source of truth; this is only the
    // fast path, so losing one report costs nothing.
  }
}

export function useSoftphone(enabled: boolean): Softphone {
  const [status, setStatus] = useState<SoftphoneStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [extensionNumber, setExtensionNumber] = useState<string | null>(null);
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [attempt, setAttempt] = useState(0);

  const phoneRef = useRef<WebPhone | null>(null);
  const sessionRef = useRef<CallSession | null>(null);
  // Read inside async callbacks and SDK event handlers, which are bound once
  // and must not re-subscribe every time the call changes.
  const callRef = useRef<ActiveCall | null>(null);
  useEffect(() => {
    callRef.current = call;
  }, [call]);

  const bindSession = useCallback((session: CallSession) => {
    sessionRef.current = session;
    const base: ActiveCall = {
      id: session.callId,
      direction: session.direction,
      remoteNumber: session.remoteNumber,
      remoteName:
        (session as InboundCallSession).rcApiCallInfo?.callerIdName ?? null,
      state: "ringing",
      muted: false,
      held: false,
      answeredAt: null,
      startedAt: Date.now(),
    };
    setCall(base);

    session.on("answered", () =>
      setCall((c) => (c ? { ...c, state: "answered", answeredAt: Date.now() } : c)),
    );
    session.on("failed", () =>
      setCall((c) => (c ? { ...c, state: "failed" } : c)),
    );
    session.on("disposed", () => {
      const ended = Date.now();
      const current = callRef.current;
      if (current) void reportCall({ ...current, state: "ended" }, ended);
      sessionRef.current = null;
      setCall((c) => (c ? { ...c, state: "ended" } : c));
      // Leave the ended card up briefly so the outcome is readable.
      setTimeout(() => setCall((c) => (c?.state === "ended" ? null : c)), 2500);
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let phone: WebPhone | null = null;

    (async () => {
      setStatus("connecting");
      setError(null);
      try {
        const res = await fetch("/api/ringcentral/sip-provision", {
          method: "POST",
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error ?? `Provisioning failed (${res.status})`);
        }
        const sip = (await res.json()) as SipProvision;
        if (cancelled) return;
        setExtensionNumber(sip.extensionNumber);

        // WebRTC touches `window`, so the SDK is only imported in the browser.
        const { default: WebPhoneSdk } = await import("ringcentral-web-phone");
        if (cancelled) return;

        phone = new WebPhoneSdk({
          sipInfo: {
            domain: sip.domain,
            outboundProxy: sip.outboundProxy,
            outboundProxyBackup: sip.outboundProxyBackup,
            username: sip.username,
            authorizationId: sip.authorizationId,
            password: sip.password,
            stunServers: sip.stunServers,
          },
        });
        phone.on("inboundCall", (session: InboundCallSession) => {
          // One call at a time: a second invite while busy is declined rather
          // than silently stealing the audio device.
          if (sessionRef.current) {
            void session.decline();
            return;
          }
          bindSession(session);
        });
        phone.on("outboundCall", (session: CallSession) => bindSession(session));

        await phone.start();
        if (cancelled) {
          await phone.dispose();
          return;
        }
        phoneRef.current = phone;
        setStatus("registered");
      } catch (err) {
        if (cancelled) return;
        setStatus("failed");
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      const p = phoneRef.current ?? phone;
      phoneRef.current = null;
      void p?.dispose().catch(() => {});
    };
  }, [enabled, attempt, bindSession]);

  const dial = useCallback(async (number: string) => {
    const phone = phoneRef.current;
    if (!phone) throw new Error("The softphone is not registered yet");
    if (sessionRef.current) throw new Error("There is already a call in progress");
    await phone.call(number.replace(/[^\d+*#]/g, ""));
  }, []);

  const answer = useCallback(async () => {
    const s = sessionRef.current as InboundCallSession | null;
    if (s?.direction === "inbound") await s.answer();
  }, []);

  const decline = useCallback(async () => {
    const s = sessionRef.current as InboundCallSession | null;
    if (s?.direction === "inbound") await s.decline();
  }, []);

  const hangup = useCallback(async () => {
    await sessionRef.current?.hangup();
  }, []);

  const toggleMute = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    setCall((c) => {
      if (!c) return c;
      if (c.muted) s.unmute();
      else s.mute();
      return { ...c, muted: !c.muted };
    });
  }, []);

  const toggleHold = useCallback(async () => {
    const s = sessionRef.current;
    const current = callRef.current;
    if (!s || !current) return;
    if (current.held) await s.unhold();
    else await s.hold();
    setCall((c) => (c ? { ...c, held: !c.held } : c));
  }, []);

  const sendDtmf = useCallback((tones: string) => {
    sessionRef.current?.sendDtmf(tones);
  }, []);

  const transfer = useCallback(async (target: string) => {
    await sessionRef.current?.transfer(target.replace(/[^\d+*#]/g, ""));
  }, []);

  const reconnect = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    // Derived rather than stored: with no RingCentral connected there is
    // nothing to register, and writing that into state from the effect just
    // to read it back causes an extra render pass.
    status: enabled ? status : "unconfigured",
    error: enabled ? error : null,
    extensionNumber,
    call,
    dial,
    answer,
    decline,
    hangup,
    toggleMute,
    toggleHold,
    sendDtmf,
    transfer,
    reconnect,
  };
}
