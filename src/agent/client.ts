/**
 * Clauduck - Claude Agent SDK Integration
 *
 * Claude Agent SDK client configuration for MiniMax M2.1
 */

import { query, Options } from "@anthropic-ai/claude-agent-sdk";
import type { CommandMode } from "../utils/types.js";

/**
 * Get Claude Agent SDK options configured for MiniMax
 *
 * Key insight: Setting ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY
 * in the env object makes the SDK use MiniMax instead of Anthropic!
 */
export function getMiniMaxOptions(mode: CommandMode = "read"): Options {
  // Tools based on mode
  const allowedTools = mode === "write"
    ? ["Read", "Write", "Edit", "Bash", "Glob", "Grep"]
    : ["Read", "Grep", "Glob", "Bash"];

  return {
    allowedTools,
    permissionMode: "bypassPermissions",
    env: {
      ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
      ANTHROPIC_API_KEY: process.env.MINIMAX_API_KEY || "",
    },
    cwd: process.cwd(),
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
Always cite relevant code or files when making claims.`;

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
 * Execute a query with the Claude Agent SDK
 */
export async function executeQuery(
  prompt: string,
  mode: CommandMode = "read",
  cwd?: string
): Promise<string> {
  const options = getMiniMaxOptions(mode);

  if (cwd) {
    options.cwd = cwd;
  }

  let result = "";

  for await (const message of query({ prompt, options })) {
    if ("result" in message) {
      result = message.result;
    }
  }

  return result;
}

/**
 * Execute a query with streaming output
 * Yields chunks of the result as they become available
 */
export async function* executeQueryStreaming(
  prompt: string,
  mode: CommandMode = "read",
  cwd?: string
): AsyncGenerator<string, void, unknown> {
  const options = getMiniMaxOptions(mode);

  if (cwd) {
    options.cwd = cwd;
  }

  for await (const message of query({ prompt, options })) {
    if ("result" in message) {
      yield message.result;
    }
  }
}
