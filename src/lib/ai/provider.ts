import { createAnthropic } from "@ai-sdk/anthropic";
import { getSecret, getWorkspaceAnthropicKey } from "@/lib/settings";

/**
 * Resolves the Anthropic API key for a workspace: the client's own key first,
 * falling back to the agency-level key (and env in local dev).
 */
async function resolveKey(workspaceId?: string): Promise<string | null> {
  const own = workspaceId ? await getWorkspaceAnthropicKey(workspaceId) : null;
  return own ?? (await getSecret("anthropic_api_key"));
}

/**
 * Anthropic provider. Pass a workspaceId to use that client's own key
 * (Settings → Connections); otherwise the agency-level key is used.
 */
export async function anthropicProvider(workspaceId?: string) {
  const apiKey = await resolveKey(workspaceId);
  if (!apiKey) {
    throw new Error(
      "Anthropic API key is not configured. Add it in Settings → Connections.",
    );
  }
  return createAnthropic({ apiKey });
}

export async function isAiConfigured(workspaceId?: string): Promise<boolean> {
  return Boolean(await resolveKey(workspaceId));
}
