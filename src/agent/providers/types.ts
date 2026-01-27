import type { CommandMode, GitHubContext, AgentResponse, AgentProvider } from "../../utils/types.js";
import type { SessionStore } from "../session-store.js";

export interface ProviderCapabilities {
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsBash: boolean;
}

export interface ProviderRunOptions {
  context: GitHubContext;
  prompt: string;
  mode: CommandMode;
  sessionKey: string;
  sessionStore: SessionStore;
  systemPrompt: string;
}

export interface ProviderAdapter {
  id: AgentProvider;
  displayName: string;
  capabilities: ProviderCapabilities;
  runSession(options: ProviderRunOptions): Promise<AgentResponse>;
  runSessionStream?(options: ProviderRunOptions): AsyncGenerator<string, void, unknown>;
}
