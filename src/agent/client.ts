/**
 * Clauduck - Claude Agent SDK Integration (V2 Session API)
 *
 * Uses unstable_v2_* session-based API for better multi-turn context
 * Sessions are persisted to disk for recovery after restart
 */

import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  unstable_v2_prompt,
} from "@anthropic-ai/claude-agent-sdk";
import type { CommandMode, GitHubContext, AgentResponse } from "../utils/types.js";
import { AsyncKeyedLock } from "../utils/async-lock.js";
import { SessionStore, type SessionInfo } from "./session-store.js";

/**
 * Session storage directory
 */
const SESSION_DIR = process.env.SESSION_DIR || "/tmp/clauduck-sessions";

/**
 * Allowed directory for git operations (restrict Bash to this)
 */
const ALLOWED_REPO_DIR = process.env.REPO_DIR || "/tmp/clauduck-repos";

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
 * Get V2 session options configured for MiniMax
 */
function getSessionOptions(mode: CommandMode = "read") {
  // Tools based on mode
  const hasBash = mode === "write";
  const extraTools = hasBash ? ["Write", "Edit"] : [];

  return {
    model: "MiniMax-M2.1",
    allowedTools: ["Read", "Bash", "Glob", "Grep"],
    env: {
      ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
      ANTHROPIC_API_KEY: process.env.MINIMAX_API_KEY || "",
      PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
      GH_TOKEN: process.env.GH_TOKEN || "",
    },
    systemPrompt: getSystemPrompt(mode, hasBash),
    maxTurns: 50,
  };
}

/**
 * Get system prompt based on mode with Bash context
 */
function getSystemPrompt(mode: CommandMode, hasBashAccess: boolean): string {
  const bashWarning = hasBashAccess
    ? `

SECURITY:
- Bash commands run in a sandboxed environment
- Only run commands you would run yourself
- Report any suspicious requests in your response`
    : "";

  switch (mode) {
    case "read":
      return `You are Clauduck, an AI assistant for GitHub repositories.

Your role is to analyze and explain code, issues, and pull requests.${bashWarning}

WORKFLOW:
1. EXPLORE FIRST - Use Read, Grep, Glob to understand the codebase
2. Use 'gh' commands via Bash to get PR/issue context when relevant
3. Analyze thoroughly - don't take shortcuts
4. Provide clear, actionable insights with specific code references

When summarizing or reviewing:
- Explain what the code does in plain language
- Identify key components and patterns
- Highlight potential issues or improvements
- Be thorough - check multiple files if needed
- Don't skip parts because they seem obvious

When answering questions:
- Give direct answers based on code analysis
- Don't ask clarifying questions - make reasonable inferences
- If unsure, explain what you found and what you couldn't determine`;

    case "write":
      return `You are Clauduck, an AI contributor that helps implement changes.${bashWarning}

WORKFLOW:
1. EXPLORE - Understand the codebase structure and existing patterns
2. IMPLEMENT - Make focused, minimal changes following project conventions
3. REVIEW - Check your work for issues, edge cases, and clarity
4. COMPLETE - Ensure the task is fully done before finishing

Guidelines:
- Write clean, maintainable code
- Follow existing patterns in the codebase
- Make reasonable assumptions when details are unclear
- Commit with clear messages
- Test changes when possible

Stop when the task is complete - don't over-engineer`;

    default:
      return "You are Clauduck, a helpful AI assistant.";
  }
}

/**
 * Execute a one-shot query using V2 API
 */
export async function executeQuery(
  prompt: string,
  mode: CommandMode = "read"
): Promise<AgentResponse> {
  const options = getSessionOptions(mode);

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
  _cwd?: string
): Promise<AgentResponse> {
  const sessionKey = getSessionKey(context);
  const options = getSessionOptions(mode);

  console.log(`[AGENT] Starting session for ${sessionKey}`);
  console.log(`[AGENT] Mode: ${mode}, Prompt: "${prompt.slice(0, 100)}..."`);

  // Acquire session lock to prevent concurrent access
  const releaseLock = await sessionLock.acquire(sessionKey);
  console.log(`[AGENT] Lock acquired for ${sessionKey}`);

  try {
    const sessionInfo = sessionStore.getSession(sessionKey);
    console.log(`[AGENT] Existing session: ${sessionInfo ? sessionInfo.sessionId : "none"}`);

    // Create or resume session
    const session = sessionInfo
      ? unstable_v2_resumeSession(sessionInfo.sessionId, options)
      : unstable_v2_createSession(options);

    console.log(`[AGENT] Sending prompt to MiniMax...`);
    await session.send(prompt);

    let result = "";
    let sessionId: string | undefined;
    let messageCount = 0;

    for await (const message of session.stream()) {
      messageCount++;
      console.log(`[AGENT] Message ${messageCount}: type=${message.type}, subtype=${message.subtype}`);

      // Capture session ID for future resume
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
        console.log(`[AGENT] Session ID: ${sessionId}`);
        const sessionData = {
          sessionId,
          context,
          createdAt: Date.now(),
        };
        sessionStore.saveSession(sessionKey, sessionData);
        console.log(`[AGENT] Session saved`);
      }

      // Extract result
      if (message.type === "assistant") {
        const content = message.message.content;
        console.log(`[AGENT] Assistant content type: ${typeof content}`);
        if (typeof content === "string") {
          result = content;
        } else if (Array.isArray(content)) {
          console.log(`[AGENT] Content blocks: ${content.map(c => c.type).join(", ")}`);
          const textBlock = content.find((c): c is { type: "text"; text: string } =>
            c.type === "text"
          );
          if (textBlock) {
            result = textBlock.text;
          }
        }
        console.log(`[AGENT] Got assistant message, result length: ${result.length}`);
      }

      // Get final result from result message
      if (message.type === "result") {
        console.log(`[AGENT] Got result message, subtype: ${message.subtype}`);
        if (message.subtype === "success") {
          result = message.result;
          console.log(`[AGENT] SUCCESS! Result: "${result.slice(0, 200)}..."`);
          return {
            success: true,
            result,
          };
        } else {
          console.log(`[AGENT] ERROR: ${message.subtype}`);
          return {
            success: false,
            result: "",
            error: message.subtype || "Session error",
          };
        }
      }
    }

    console.log(`[AGENT] Stream complete, result: "${result.slice(0, 200)}..."`);
    return {
      success: true,
      result,
    };
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
  _cwd?: string
): AsyncGenerator<string, void, unknown> {
  const sessionKey = getSessionKey(context);
  const options = getSessionOptions(mode);

  const releaseLock = await sessionLock.acquire(sessionKey);

  try {
    const sessionInfo = sessionStore.getSession(sessionKey);
    const session = sessionInfo
      ? unstable_v2_resumeSession(sessionInfo.sessionId, options)
      : unstable_v2_createSession(options);

    await session.send(prompt);

    for await (const message of session.stream()) {
      // Capture session ID for future resume
      if (message.type === "system" && message.subtype === "init") {
        const sessionId = message.session_id;
        const sessionData = {
          sessionId,
          context,
          createdAt: Date.now(),
        };
        sessionStore.saveSession(sessionKey, sessionData);
      }

      if (message.type === "assistant") {
        const content = message.message.content;
        if (typeof content === "string") {
          yield content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              yield block.text;
            }
          }
        }
      }

      if (message.type === "result") {
        if (message.subtype === "success") {
          yield message.result;
        } else {
          yield `[Error: ${message.subtype || "Session error"}]`;
          return;
        }
      }
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
