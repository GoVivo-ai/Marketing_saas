/**
 * Slack incoming webhooks — the simplest way to drop a message in a channel.
 * Create one in Slack (Apps → Incoming Webhooks → pick the channel) and put
 * its URL in the env var the caller reads. Best-effort: a Slack outage never
 * fails the request that produced the event.
 */
export async function postToSlack(
  webhookUrl: string | undefined,
  message: { text: string; blocks?: unknown[] },
): Promise<boolean> {
  if (!webhookUrl) return false;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`[slack] webhook responded ${res.status}`);
    return res.ok;
  } catch (err) {
    console.error("[slack] webhook failed:", err);
    return false;
  }
}
