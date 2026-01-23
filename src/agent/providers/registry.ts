import type { AgentProvider, ProviderOverride } from "../../utils/types.js";
import type { ProviderAdapter } from "./types.js";
import { claudeProvider } from "./claude.js";
import { codexProvider } from "./codex.js";

const registry: Record<AgentProvider, ProviderAdapter> = {
  claude: claudeProvider,
  codex: codexProvider,
};

const providerAliases: Record<string, AgentProvider> = {
  claude: "claude",
  codex: "codex",
  minimax: "claude",
  anthropic: "claude",
};

export function resolveProviderId(override?: ProviderOverride): AgentProvider {
  const raw = (override ?? process.env.AI_PROVIDER ?? "claude").toLowerCase().trim();
  return providerAliases[raw] ?? "claude";
}

export function getProvider(provider: AgentProvider): ProviderAdapter {
  return registry[provider];
}

export function listProviders(): ProviderAdapter[] {
  return Object.values(registry);
}
