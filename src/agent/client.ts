/**
 * Clauduck - GitHub Bot with Claude Agent SDK
 *
 * Claude Agent SDK client configuration for MiniMax M2.1
 */

import { query, Options } from "@anthropic-ai/claude-agent-sdk";

/**
 * Get Claude Agent SDK options configured for MiniMax
 *
 * Key insight: Setting ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY
 * in the env object makes the SDK use MiniMax instead of Anthropic!
 */
export function getMiniMaxOptions(): Options {
  return {
    // Tools the agent can use
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],

    // Bypass permission prompts for automation
    permissionMode: "bypassPermissions",

    // Environment variables for MiniMax
    env: {
      ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
      ANTHROPIC_API_KEY: process.env.MINIMAX_API_KEY || "",
    },

    // Working directory for file operations
    cwd: process.cwd(),

    // Custom system prompt
    systemPrompt: "You are Clauduck, a helpful AI assistant.",

    // Maximum conversation turns
    maxTurns: 50,
  };
}

/**
 * Execute a prompt with the Claude Agent SDK
 */
export async function executeQuery(
  prompt: string,
  cwd?: string
): Promise<string> {
  const options = getMiniMaxOptions();

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
