/**
 * Clauduck - Claude Agent SDK Integration (V2 Session API)
 *
 * Uses unstable_v2_* session-based API for better multi-turn context
 * Sessions are persisted to disk for recovery after restart
 */

import { unstable_v2_prompt } from "@anthropic-ai/claude-agent-sdk";
import type { CommandMode, GitHubContext, AgentResponse, ProviderOverride } from "../utils/types.js";
import { AsyncKeyedLock } from "../utils/async-lock.js";
import { SessionStore, type SessionInfo } from "./session-store.js";
import { getSystemPrompt } from "./system-prompt.js";
import { getProvider, resolveProviderId } from "./providers/registry.js";
import { getClaudeSessionOptions } from "./providers/claude.js";

/**
 * Session storage directory
 */
const SESSION_DIR = process.env.SESSION_DIR || "/tmp/clauduck-sessions";

/**
 * Session key for tracking sessions per issue/PR
 */
function getSessionKey(context: GitHubContext): string {
  return `${context.owner}/${context.repo}#${context.issueNumber}`;
}

// Session TTL: 24 hours (prevents unbounded memory growth)
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const sessionStore = new SessionStore({
  dir: SESSION_DIR,
  ttlMs: SESSION_TTL_MS,
});

// Session locks for concurrent command handling (per session key)
const sessionLock = new AsyncKeyedLock();

/**
 * Load all persisted sessions on startup
 */
sessionStore.loadAllPersistedSessions();

// Start periodic cleanup (every hour)
const cleanupInterval = setInterval(() => sessionStore.cleanupExpiredSessions(), 60 * 60 * 1000);

/**
 * Shutdown function to clean up resources
 */
export function shutdown(): void {
  clearInterval(cleanupInterval);
}

/**
 * Execute a one-shot query using V2 API
 */
export async function executeQuery(
  prompt: string,
  mode: CommandMode = "read",
  providerOverride?: ProviderOverride
): Promise<AgentResponse> {
  const providerId = resolveProviderId(providerOverride);
  if (providerId !== "claude") {
    return {
      success: false,
      result: "",
      error: "executeQuery is only supported for the Claude provider",
    };
  }

  const systemPrompt = getSystemPrompt(mode, {
    supportsTools: true,
    supportsBash: mode === "write",
  });
  const options = getClaudeSessionOptions(systemPrompt, mode === "write");

  try {
    const result = await unstable_v2_prompt(prompt, {
      ...options,
      model: "MiniMax-M2.1",
    });

    if (result.subtype === "success") {
      return {
        success: true,
        result: result.result,
      };
    } else {
      return {
        success: false,
        result: "",
        error: result.subtype,
      };
    }
  } catch (error) {
    console.error(`[AGENT] ERROR: ${error instanceof Error ? error.message : "Unknown error"}`);
    return {
      success: false,
      result: "",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute a session-based query with context
 * Creates or resumes a session for the given GitHub context
 */
export async function executeSessionQuery(
  context: GitHubContext,
  prompt: string,
  mode: CommandMode = "read",
  providerOverride?: ProviderOverride,
  _cwd?: string
): Promise<AgentResponse> {
  const sessionKey = getSessionKey(context);
  const providerId = resolveProviderId(providerOverride);
  const provider = getProvider(providerId);
  const systemPrompt = getSystemPrompt(mode, {
    supportsTools: provider.capabilities.supportsTools,
    supportsBash: provider.capabilities.supportsBash && mode === "write",
  });

  console.log(`[AGENT] Starting ${providerId} session for ${sessionKey}`);
  console.log(`[AGENT] Mode: ${mode}, Prompt: "${prompt.slice(0, 100)}..."`);

  // Acquire session lock to prevent concurrent access
  const releaseLock = await sessionLock.acquire(sessionKey);
  console.log(`[AGENT] Lock acquired for ${sessionKey}`);

  try {
    const sessionInfo = sessionStore.getSession(sessionKey);
    if (sessionInfo && (sessionInfo.provider ?? "claude") !== providerId) {
      const existingProvider = sessionInfo.provider ?? "claude";
      console.log(`[AGENT] Provider changed (${existingProvider} -> ${providerId}), clearing session`);
      sessionStore.deleteSession(sessionKey);
    }

    return await provider.runSession({
      context,
      prompt,
      mode,
      sessionKey,
      sessionStore,
      systemPrompt,
    });
  } catch (error) {
    console.error(`[AGENT] ERROR: ${error instanceof Error ? error.message : "Unknown error"}`);
    return {
      success: false,
      result: "",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    // Always release the session lock
    releaseLock();
    console.log(`[AGENT] Lock released for ${sessionKey}`);
  }
}

/**
 * Execute a streaming session query
 */
export async function* executeSessionStreaming(
  context: GitHubContext,
  prompt: string,
  mode: CommandMode = "read",
  providerOverride?: ProviderOverride,
  _cwd?: string
): AsyncGenerator<string, void, unknown> {
  const sessionKey = getSessionKey(context);
  const providerId = resolveProviderId(providerOverride);
  const provider = getProvider(providerId);
  const systemPrompt = getSystemPrompt(mode, {
    supportsTools: provider.capabilities.supportsTools,
    supportsBash: provider.capabilities.supportsBash && mode === "write",
  });

  const releaseLock = await sessionLock.acquire(sessionKey);

  try {
    const sessionInfo = sessionStore.getSession(sessionKey);
    if (sessionInfo && (sessionInfo.provider ?? "claude") !== providerId) {
      sessionStore.deleteSession(sessionKey);
    }

    if (provider.runSessionStream) {
      for await (const chunk of provider.runSessionStream({
        context,
        prompt,
        mode,
        sessionKey,
        sessionStore,
        systemPrompt,
      })) {
        yield chunk;
      }
      return;
    }

    const result = await provider.runSession({
      context,
      prompt,
      mode,
      sessionKey,
      sessionStore,
      systemPrompt,
    });

    if (result.success) {
      yield result.result;
    } else {
      yield `[Error: ${result.error || "Session error"}]`;
    }
  } finally {
    releaseLock();
  }
}

/**
 * Clear session for a GitHub context (start fresh)
 */
export function clearSession(context: GitHubContext): void {
  const sessionKey = getSessionKey(context);
  sessionStore.deleteSession(sessionKey);
}

/**
 * Get active session info for a context
 */
export function getSessionInfo(context: GitHubContext): SessionInfo | undefined {
  const sessionKey = getSessionKey(context);
  return sessionStore.getSession(sessionKey);
}

/**
 * List all active sessions
 */
export function listSessions(): SessionInfo[] {
  return sessionStore.listSessions();
}
