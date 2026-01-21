/**
 * Clauduck - GitHub Bot with Claude Agent SDK
 *
 * This file demonstrates how to use the Claude Agent SDK.
 *
 * LESSON 1: The query() Function
 * ================================
 *
 * The core of the Claude Agent SDK is the `query()` function.
 * It creates an async generator that streams messages as they arrive.
 *
 * Key concepts:
 * 1. `query()` returns an AsyncGenerator - you iterate with for-await-of
 * 2. Each message has a `type` that tells us what kind of message it is
 * 3. We configure behavior via the `options` parameter
 * 4. Environment variables (like API keys) go in the `env` option
 */

import { query, Options } from "@anthropic-ai/claude-agent-sdk";

/**
 * Basic example of calling the Claude Agent SDK
 *
 * The query() function signature:
 *   query({ prompt: string, options?: Options })
 *
 * Options includes:
 * - allowedTools: Array of tool names the agent can use
 * - env: Environment variables passed to the subprocess
 * - cwd: Working directory for the agent
 * - permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
 */
export async function simpleQuery(prompt: string): Promise<string> {
  // For now, let's just demonstrate the structure
  // Full implementation comes in Phase 4

  console.log("=== LESSON 1: query() Function ===");
  console.log("Prompt:", prompt);
  console.log();
  console.log("The query() function returns an async generator.");
  console.log("You iterate over it with 'for await (const message of query(...))'");
  console.log();
  console.log("Each message has a 'type' property:");
  console.log("  - 'assistant': Claude's response (text or tool use)");
  console.log("  - 'user': Tool results from executed tools");
  console.log("  - 'result': Final result when done");
  console.log();

  return "Demo complete - see Phase 4 for full implementation";
}

/**
 * Example of how we'll configure the SDK for MiniMax
 *
 * The key insight: we set ANTHROPIC_BASE_URL and ANTHROPIC_API_KEY
 * in the env object, and the SDK will use MiniMax instead of Anthropic!
 */
export function getMiniMaxOptions(): Options {
  return {
    // Tools the agent can use
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],

    // Bypass permission prompts for automation
    permissionMode: "bypassPermissions",

    // Environment variables - THIS IS HOW WE USE MINIMAX!
    env: {
      ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
      ANTHROPIC_API_KEY: process.env.MINIMAX_API_KEY || "",
    },

    // Working directory for file operations
    cwd: process.cwd(),

    // Optional: Custom system prompt
    systemPrompt: "You are Clauduck, a helpful AI assistant.",

    // Optional: Maximum conversation turns
    maxTurns: 50,
  };
}

// Run demo if executed directly
if (require.main === module) {
  simpleQuery("Hello, Clauduck!").then(console.log);
}
