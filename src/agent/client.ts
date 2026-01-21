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
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync, chmodSync, renameSync } from "fs";
import { join } from "path";
import type { CommandMode, GitHubContext, AgentResponse } from "../utils/types.js";

/**
 * Session storage directory
 */
const SESSION_DIR = process.env.SESSION_DIR || "/tmp/clauduck-sessions";

/**
 * Allowed directory for git operations (restrict Bash to this)
 */
const ALLOWED_REPO_DIR = process.env.REPO_DIR || "/tmp/clauduck-repos";

/**
 * Initialize session storage directory with secure permissions
 */
function initSessionStorage(): void {
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
    // Set restrictive permissions (owner only)
    chmodSync(SESSION_DIR, 0o700);
  }
}

/**
 * Session key for tracking sessions per issue/PR
 */
function getSessionKey(context: GitHubContext): string {
  return `${context.owner}/${context.repo}#${context.issueNumber}`;
}

// Session TTL: 24 hours (prevents unbounded memory growth)
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// In-memory session storage
interface SessionInfo {
  sessionId: string;
  context: GitHubContext;
  createdAt: number;
}
const sessions = new Map<string, SessionInfo>();

/**
 * Persist session to disk with secure permissions
 */
function persistSession(key: string, session: SessionInfo): void {
  try {
    const filePath = join(SESSION_DIR, `${Buffer.from(key).toString("base64")}.json`);
    // Write to temp file first, then rename for atomic write
    const tempPath = `${filePath}.${Date.now()}.tmp`;
    writeFileSync(tempPath, JSON.stringify(session, null, 2), { mode: 0o600 });
    // Atomic rename
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    // Rename temp to final path
    try {
      renameSync(tempPath, filePath);
    } catch {
      // Fallback: copy content if rename fails (e.g., cross-device)
      writeFileSync(filePath, readFileSync(tempPath));
      unlinkSync(tempPath);
    }
  } catch (error) {
    console.error(`Failed to persist session ${key}:`, error);
  }
}

/**
 * Load all persisted sessions on startup
 */
function loadAllPersistedSessions(): void {
  initSessionStorage();
  try {
    const files = readdirSync(SESSION_DIR);
    let loaded = 0;
    for (const file of files) {
      if (file.endsWith(".json") && !file.endsWith(".tmp")) {
        try {
          const data = JSON.parse(readFileSync(join(SESSION_DIR, file), "utf-8"));
          if (Date.now() - data.createdAt <= SESSION_TTL_MS) {
            const key = Buffer.from(file.replace(".json", ""), "base64").toString();
            sessions.set(key, data);
            loaded++;
          }
        } catch {
          // Skip corrupted files
        }
      }
    }
    if (loaded > 0) {
      console.log(`Loaded ${loaded} persisted sessions`);
    }
  } catch (error) {
    console.error("Failed to load persisted sessions:", error);
  }
}

// Load persisted sessions on module load
loadAllPersistedSessions();

/**
 * Clean up expired sessions (runs periodically)
 */
function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(key);
      // Also delete persisted file
      try {
        const filePath = join(SESSION_DIR, `${Buffer.from(key).toString("base64")}.json`);
        if (existsSync(filePath)) {
          unlinkSync(filePath);
        }
      } catch {
        // Ignore cleanup errors
      }
      console.log(`Cleaned up expired session: ${key}`);
    }
  }
}

// Start periodic cleanup (every hour)
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

/**
 * Get V2 session options configured for MiniMax
 */
function getSessionOptions(mode: CommandMode = "read") {
  // Tools based on mode - read mode has NO Bash for security
  const hasBash = mode === "write";
  const allowedTools = hasBash
    ? ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    : ["Read", "Grep", "Glob"];

  return {
    model: "MiniMax-M2.1",
    allowedTools,
    // Use default permission mode - commands require approval
    permissionMode: "default" as const,
    env: {
      ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
      ANTHROPIC_API_KEY: process.env.MINIMAX_API_KEY || "",
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
    ? `\n\nIMPORTANT: Bash commands are restricted to:
- Read-only commands (cat, grep, ls, find, git status, etc.) are allowed globally
- Write commands must target ${ALLOWED_REPO_DIR}
- Dangerous commands (rm -rf, sudo, wget|sh, etc.) are blocked`
    : "";

  switch (mode) {
    case "read":
      return `You are Clauduck, a helpful AI assistant for GitHub repositories.

Your role is to analyze and explain code, issues, and pull requests.
Be concise and helpful in your responses.
When asked to summarize or review, provide clear, actionable insights.
Always cite relevant code or files when making claims.
Do NOT execute any commands - only read and analyze.${bashWarning}`;

    case "write":
      return `You are Clauduck, an AI contributor that helps implement changes.

Your role is to write code, fix bugs, and create features.
Always:
- Explore the repository structure to understand the codebase
- Make minimal, focused changes
- Write clear commit messages
- Test your changes when possible
- Ask for clarification if the request is ambiguous${bashWarning}`;

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

  try {
    const sessionInfo = sessions.get(sessionKey);

    // Create or resume session
    const session = sessionInfo
      ? unstable_v2_resumeSession(sessionInfo.sessionId, options)
      : unstable_v2_createSession(options);

    await session.send(prompt);

    let result = "";
    let sessionId: string | undefined;

    for await (const message of session.stream()) {
      // Capture session ID for future resume
      if (message.type === "system" && message.subtype === "init") {
        sessionId = message.session_id;
        const sessionData = {
          sessionId,
          context,
          createdAt: Date.now(),
        };
        sessions.set(sessionKey, sessionData);
        persistSession(sessionKey, sessionData);
      }

      // Extract result
      if (message.type === "assistant") {
        const content = message.message.content;
        if (typeof content === "string") {
          result = content;
        } else if (Array.isArray(content)) {
          const textBlock = content.find((c): c is { type: "text"; text: string } =>
            c.type === "text"
          );
          if (textBlock) {
            result = textBlock.text;
          }
        }
      }

      // Get final result from result message
      if (message.type === "result") {
        if (message.subtype === "success") {
          result = message.result;
        } else {
          return {
            success: false,
            result: "",
            error: message.subtype || "Session error",
          };
        }
      }
    }

    return {
      success: true,
      result,
    };
  } catch (error) {
    return {
      success: false,
      result: "",
      error: error instanceof Error ? error.message : "Unknown error",
    };
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

  const sessionInfo = sessions.get(sessionKey);
  const session = sessionInfo
    ? unstable_v2_resumeSession(sessionInfo.sessionId, options)
    : unstable_v2_createSession(options);

  await session.send(prompt);

  for await (const message of session.stream()) {
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
}

/**
 * Clear session for a GitHub context (start fresh)
 */
export function clearSession(context: GitHubContext): void {
  const sessionKey = getSessionKey(context);
  sessions.delete(sessionKey);
  // Remove persisted file
  try {
    const filePath = join(SESSION_DIR, `${Buffer.from(sessionKey).toString("base64")}.json`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Get active session info for a context
 */
export function getSessionInfo(context: GitHubContext): SessionInfo | undefined {
  const sessionKey = getSessionKey(context);
  return sessions.get(sessionKey);
}

/**
 * List all active sessions
 */
export function listSessions(): SessionInfo[] {
  return Array.from(sessions.values());
}
