import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
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

// ─────────────────────────────────────────────────────────────────────────
// Lead scoring model — high volume, so it runs on the cheapest capable model
// of whichever provider has a key configured. OpenAI wins when its key is
// present (Settings/env OPENAI_API_KEY); otherwise Anthropic Haiku.
// ─────────────────────────────────────────────────────────────────────────

/** Cheap OpenAI model for bulk scoring (~$0.25/M in, $2/M out). */
const OPENAI_SCORING_MODEL = "gpt-5-mini";
/** Anthropic fallback — high volume, low latency. */
const ANTHROPIC_SCORING_MODEL = "claude-haiku-4-5-20251001";

/**
 * The model bulk lead scoring runs on, or null when no AI key is configured
 * at all. `label` names the provider/model for logs.
 */
export async function scoringModel(
  workspaceId?: string,
): Promise<{ model: LanguageModel; label: string } | null> {
  const openaiKey = await getSecret("openai_api_key");
  if (openaiKey) {
    const openai = createOpenAI({ apiKey: openaiKey });
    return {
      model: openai(OPENAI_SCORING_MODEL),
      label: `openai/${OPENAI_SCORING_MODEL}`,
    };
  }
  const anthropicKey = await resolveKey(workspaceId);
  if (anthropicKey) {
    const anthropic = createAnthropic({ apiKey: anthropicKey });
    return {
      model: anthropic(ANTHROPIC_SCORING_MODEL),
      label: `anthropic/${ANTHROPIC_SCORING_MODEL}`,
    };
  }
  return null;
}
