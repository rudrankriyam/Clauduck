/**
 * Clauduck - Claude Agent SDK Integration (V2 Session API)
 *
 * Uses unstable_v2_* session-based API for better multi-turn context
 */

import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
  unstable_v2_prompt,
} from "@anthropic-ai/claude-agent-sdk";
import type { CommandMode, GitHubContext, AgentResponse } from "../utils/types.js";

/**
 * Session key for tracking sessions per issue/PR
 */
function getSessionKey(context: GitHubContext): string {
  return `${context.owner}/${context.repo}#${context.issueNumber}`;
}

// In-memory session storage (can be persisted to disk/db in production)
interface SessionInfo {
  sessionId: string;
  context: GitHubContext;
  createdAt: number;
}
const sessions = new Map<string, SessionInfo>();

/**
 * Get V2 session options configured for MiniMax
 */
function getSessionOptions(mode: CommandMode = "read") {
  // Tools based on mode - read mode has NO bash for security
  const allowedTools = mode === "write"
    ? ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    : ["Read", "Grep", "Glob"];

  return {
    model: "MiniMax-M2.1", // MiniMax should map this appropriately
    allowedTools,
    permissionMode: "bypassPermissions" as const,
    env: {
      ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
      ANTHROPIC_API_KEY: process.env.MINIMAX_API_KEY || "",
    },
    systemPrompt: getSystemPrompt(mode),
    maxTurns: 50,
  };
}

/**
 * Get system prompt based on mode
 */
function getSystemPrompt(mode: CommandMode): string {
  switch (mode) {
    case "read":
      return `You are Clauduck, a helpful AI assistant for GitHub repositories.

Your role is to analyze and explain code, issues, and pull requests.
Be concise and helpful in your responses.
When asked to summarize or review, provide clear, actionable insights.
Always cite relevant code or files when making claims.
Do NOT execute any commands - only read and analyze.`;

    case "write":
      return `You are Clauduck, an AI contributor that helps implement changes.

Your role is to write code, fix bugs, and create features.
Always:
- Explore the codebase first to understand the structure
- Make minimal, focused changes
- Write clear commit messages
- Test your changes when possible
- Ask for clarification if the request is ambiguous`;

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
      model: "MiniMax-M2.1", // MiniMax should map this appropriately
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
  cwd?: string
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
        sessions.set(sessionKey, {
          sessionId,
          context,
          createdAt: Date.now(),
        });
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
      if (message.type === "result" && message.subtype === "success") {
        result = message.result;
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
  cwd?: string
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

    if (message.type === "result" && message.subtype === "success") {
      yield message.result;
    }
  }
}

/**
 * Clear session for a GitHub context (start fresh)
 */
export function clearSession(context: GitHubContext): void {
  const sessionKey = getSessionKey(context);
  sessions.delete(sessionKey);
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
