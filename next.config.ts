import type { NextConfig } from "next";

// The RingCentral Embeddable widget (in-browser calling) needs its own
// origins allowed for the adapter script, the widget iframe and WebRTC media.
const RC_ORIGIN = "https://apps.ringcentral.com";

const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts and the app layout carries one
  // small inline guard script, so 'unsafe-inline' stays for now; the RC
  // adapter script loads from apps.ringcentral.com.
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${RC_ORIGIN}`,
  "style-src 'self' 'unsafe-inline'",
  // data: covers the stored workspace logos; https: covers map tiles.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.ringcentral.com wss://*.ringcentral.com",
  `frame-src 'self' ${RC_ORIGIN}`,
  "media-src 'self' blob: https://*.ringcentral.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone is delegated to the RingCentral frame for WebRTC calls.
  {
    key: "Permissions-Policy",
    value: `camera=(), geolocation=(), microphone=(self "${RC_ORIGIN}")`,
  },
];

// The embeddable public lead form must be frameable by client sites, so its
// route swaps frame-ancestors 'none' for * and drops X-Frame-Options. Only
// the form lives there — no session UI to clickjack.
const embedCsp = csp.replace("frame-ancestors 'none'", "frame-ancestors *");
const embedHeaders = securityHeaders.map((h) => {
  if (h.key === "Content-Security-Policy") return { ...h, value: embedCsp };
  // Later rules only override same-key headers, so DENY must be replaced,
  // not removed. ALLOWALL is a no-op token; CSP frame-ancestors governs.
  if (h.key === "X-Frame-Options") return { ...h, value: "ALLOWALL" };
  return h;
});

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Later rules win on key collisions for matching paths.
      { source: "/join/:slug/embed", headers: embedHeaders },
    ];
  },
};

export default nextConfig;
