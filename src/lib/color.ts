/** Color helpers shared by branded surfaces (public form, embeds). */

/**
 * Foreground that stays readable on top of an arbitrary brand color: dark
 * slate on light accents (e.g. AlexYah's yellow), white on dark ones.
 * Unparseable values fall back to white (our accents default dark).
 */
export function accentForeground(accent: string): string {
  const m = accent.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Perceived luminance (ITU-R BT.601) — enough to pick black vs white text.
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 150 ? "#0f172a" : "#ffffff";
}
