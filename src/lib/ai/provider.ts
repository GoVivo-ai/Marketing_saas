import { createAnthropic } from "@ai-sdk/anthropic";
import { getSecret } from "@/lib/settings";

/**
 * Anthropic provider backed by the platform-managed API key
 * (Settings → Connections), with env fallback for local development.
 */
export async function anthropicProvider() {
  const apiKey = await getSecret("anthropic_api_key");
  if (!apiKey) {
    throw new Error(
      "Anthropic API key is not configured. Add it in Settings → Connections.",
    );
  }
  return createAnthropic({ apiKey });
}

export async function isAiConfigured(): Promise<boolean> {
  return Boolean(await getSecret("anthropic_api_key"));
}
