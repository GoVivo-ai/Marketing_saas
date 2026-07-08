"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Phone, X } from "lucide-react";

const CLIENT_ID = process.env.NEXT_PUBLIC_RINGCENTRAL_CLIENT_ID;
const APP_SERVER =
  process.env.NEXT_PUBLIC_RINGCENTRAL_SERVER_URL ??
  "https://platform.ringcentral.com";
const REDIRECT_URI =
  "https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/redirect.html";
const ADAPTER =
  "https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/adapter.js";
// postMessage target — lead phone numbers only go to RingCentral's own frame,
// never a wildcard origin.
const WIDGET_ORIGIN = "https://apps.ringcentral.com";

/** True when the in-browser dialer is configured for this deployment. */
export const isDialerConfigured = Boolean(CLIENT_ID);

const OPEN_EVENT = "rc-dialer-open";

type Adapter = {
  setClosed: (closed: boolean) => void;
  setMinimized: (minimized: boolean) => void;
};

function adapter(): Adapter | null {
  return (window as unknown as { RCAdapter?: Adapter }).RCAdapter ?? null;
}

// Set per Vivo user (see RingCentralDialer) so the iframe lookup matches the
// user-namespaced widget. Falls back to the widget's default id.
let frameId = "rc-widget-adapter-frame";

function widgetFrame(): Window | null {
  const iframe = document.getElementById(frameId) as HTMLIFrameElement | null;
  return iframe?.contentWindow ?? null;
}

/** Reveal the RingCentral dialpad (it starts hidden so it never covers the UI). */
export function showDialer() {
  const a = adapter();
  if (!a) return;
  a.setClosed(false);
  // Expand fully — without this it reopens minimized (the stray rectangle).
  a.setMinimized(false);
  // Let the hub know the dialpad is open so it can offer a close (X).
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Hide the dialpad entirely (the widget has no close button of its own). */
export function hideDialer() {
  adapter()?.setClosed(true);
}

/** Place a call through the embedded RingCentral dialer (WebRTC, in-browser). */
export function dialerCall(phoneNumber: string): boolean {
  const w = widgetFrame();
  if (!w) return false;
  showDialer();
  w.postMessage(
    { type: "rc-adapter-new-call", phoneNumber, toCall: true },
    WIDGET_ORIGIN,
  );
  return true;
}

/** Open the dialer's SMS composer, prefilled to this number. */
export function dialerSms(phoneNumber: string, text = ""): boolean {
  const w = widgetFrame();
  if (!w) return false;
  showDialer();
  w.postMessage(
    { type: "rc-adapter-new-sms", phoneNumber, text, conversation: true },
    WIDGET_ORIGIN,
  );
  return true;
}

/**
 * Loads the RingCentral Embeddable widget once, app-wide, and keeps it HIDDEN
 * by default. A floating "hub" sits bottom-right; tapping it makes a bubble
 * split off (gooey metaball animation, like a cell dividing) carrying the
 * RingCentral mark, and tapping that bubble opens the dialpad. The widget has
 * no close button of its own, so while it's open the hub turns into an X that
 * hides it. Agents sign in with their own RingCentral account and talk through
 * the browser — no phone or forwarding — so agents in any country can call.
 */
export function RingCentralDialer({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialpadOpen, setDialpadOpen] = useState(false);

  // Namespace the widget per company (workspace) so RingCentral sessions are
  // scoped to the company: everyone in it shares the same session, other
  // companies never cross, and a Vivo admin switching companies gets that
  // company's session.
  const prefix = "rcw" + workspaceId.replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    if (!CLIENT_ID) return;
    frameId = `${prefix}-adapter-frame`;
    if (!document.getElementById("rc-embeddable-adapter")) {
      const params = new URLSearchParams({
        clientId: CLIENT_ID,
        appServer: APP_SERVER,
        redirectUri: REDIRECT_URI,
        // No minimize button — it leaves a rectangle over our hub. We provide
        // our own close (the hub becomes an X while the dialpad is open).
        disableMinimize: "true",
        // Per-user storage + iframe id (session isolation).
        prefix,
      });
      const s = document.createElement("script");
      s.id = "rc-embeddable-adapter";
      s.async = true;
      s.src = `${ADAPTER}?${params.toString()}`;
      document.body.appendChild(s);
    }
    // The adapter exposes window.RCAdapter once ready; hide it until needed so
    // its own floating button never shows on top of our hub.
    const iv = setInterval(() => {
      const a = adapter();
      if (a) {
        a.setClosed(true);
        clearInterval(iv);
      }
    }, 400);
    // Opening from anywhere (hub bubble or a lead's Call button) flips the hub
    // into its close state.
    const onOpen = () => {
      setDialpadOpen(true);
      setMenuOpen(false);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    // The widget can also show itself — an incoming/active call, or the sign-in
    // prompt after an auth redirect. Mirror that into our state so the hub is
    // always in its closeable (X) state and the agent can dismiss the panel.
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== WIDGET_ORIGIN) return;
      const type =
        (e.data && (e.data as { type?: string }).type) || "";
      if (
        type === "rc-call-ring-notify" ||
        type === "rc-active-call-notify" ||
        type === "rc-login-popup-notify"
      ) {
        setDialpadOpen(true);
        setMenuOpen(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      clearInterval(iv);
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("message", onMessage);
    };
  }, [prefix]);

  if (!CLIENT_ID) return null;

  const hubClick = () => {
    if (dialpadOpen) {
      hideDialer();
      setDialpadOpen(false);
      setMenuOpen(false);
      return;
    }
    setMenuOpen((v) => !v);
  };

  const anyOpen = menuOpen || dialpadOpen;

  // Elastic ease gives the blob a "snap" as it separates.
  const snap = "cubic-bezier(0.68,-0.6,0.32,1.6)";
  const budTransform = menuOpen
    ? "translateY(-68px)"
    : "translateY(0) scale(0.6)";

  return (
    // While the panel is open it renders bottom-right on top of our hub (the
    // RingCentral iframe sits at a high z-index), which used to bury our close
    // button — the "sign-in modal I can't close" report. Lift the hub above the
    // panel whenever it's open so the X (or restore) control is always clickable.
    <div
      className="fixed bottom-5 right-5 h-36 w-14"
      style={{ zIndex: anyOpen ? 2147483000 : 40 }}
    >
      {/* Gooey blob layer — solid shapes only; the SVG filter blurs + thresholds
          them so the bud appears to stretch off and pinch away from the hub. */}
      <div
        className="absolute inset-0"
        style={{ filter: "url(#rc-goo)" }}
        aria-hidden="true"
      >
        <span className="absolute bottom-0 left-0 h-14 w-14 rounded-full bg-primary" />
        <span
          className="absolute bottom-1.5 left-1.5 h-11 w-11 rounded-full bg-primary transition-transform duration-500"
          style={{ transitionTimingFunction: snap, transform: budTransform }}
        />
      </div>

      {/* Crisp interactive layer — icons stay sharp (not blurred by the goo). */}
      <button
        type="button"
        onClick={showDialer}
        title="RingCentral dialer"
        aria-label="Open RingCentral dialer"
        tabIndex={menuOpen ? 0 : -1}
        className="absolute bottom-1.5 left-1.5 flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-white shadow-md ring-1 ring-black/5 transition-[transform,opacity] duration-500"
        style={{
          transitionTimingFunction: snap,
          transform: budTransform,
          opacity: menuOpen ? 1 : 0,
          pointerEvents: menuOpen ? "auto" : "none",
        }}
      >
        <Image
          src="/logos/ringcentral.png"
          alt="RingCentral"
          width={100}
          height={100}
          quality={100}
          unoptimized
          className="max-w-none"
        />
      </button>

      <button
        type="button"
        onClick={hubClick}
        title={anyOpen ? "Close" : "Calls & SMS"}
        aria-label={anyOpen ? "Close dialer" : "Open dialer menu"}
        aria-expanded={anyOpen}
        className="absolute bottom-0 left-0 flex h-14 w-14 items-center justify-center rounded-full text-primary-foreground shadow-xl transition-transform hover:scale-105 active:scale-95"
      >
        {anyOpen ? <X className="h-6 w-6" /> : <Phone className="h-6 w-6" />}
      </button>

      {/* Goo filter definition (rendered once, invisible). */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <filter id="rc-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>
    </div>
  );
}
