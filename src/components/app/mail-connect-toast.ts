"use client";

import { useEffect } from "react";
import { toast } from "sonner";

const MESSAGES: Record<string, { type: "success" | "error" | "info"; text: string }> = {
  connected: { type: "success", text: "Email connected — you can now send to leads from here." },
  denied: { type: "info", text: "Email connection cancelled." },
  error: { type: "error", text: "Could not connect your email. Try again." },
  invalid_state: { type: "error", text: "The sign-in expired. Try connecting again." },
  not_configured: { type: "error", text: "That email provider isn't configured on this server." },
};

/** Several components may mount on the same page; only one shows the toast. */
let consumed: string | null = null;

/**
 * Shows the outcome of a mailbox OAuth round-trip (`?mail=…`) once, then
 * strips the parameter so a refresh stays quiet. Reads window.location
 * instead of useSearchParams so it works without a Suspense boundary.
 */
export function useMailConnectToast() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const mail = url.searchParams.get("mail");
    if (!mail) return;
    const key = `${url.pathname}?${mail}`;
    if (consumed !== key) {
      consumed = key;
      const msg = MESSAGES[mail];
      if (msg) toast[msg.type](msg.text);
    }
    url.searchParams.delete("mail");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);
}
