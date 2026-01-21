/**
 * Clauduck - Command Router
 *
 * Routes commands to the appropriate handler based on mode
 */

import { createOctokit } from "../github/client.js";
import { executeQuery } from "../agent/client.js";
import { parseCommand } from "./parser.js";
import type { ParsedCommand, GitHubContext } from "../utils/types.js";

/**
 * Route and process a command from a GitHub event
 */
export async function processCommand(
  context: GitHubContext,
  commentBody: string
): Promise<string> {
  // Parse the command
  const command = parseCommand(commentBody);

  if (!command) {
    return "I didn't understand your command. Try `@clauduck help` for available commands.";
  }

  console.log(`Processing command: ${command.action} (${command.mode} mode)`);

  // Route based on mode
  switch (command.mode) {
    case "read":
      return await handleReadCommand(context, command);
    case "write":
      return await handleWriteCommand(context, command);
    default:
      return "Unknown command mode.";
  }
}

/**
 * Handle read-only commands (summarize, review, explain, etc.)
 */
async function handleReadCommand(
  context: GitHubContext,
  command: ParsedCommand
): Promise<string> {
  // Build context for the query
  const prompt = buildReadPrompt(context, command);

  try {
    const result = await executeQuery(prompt, "read");
    return result.success ? result.result : `Error: ${result.error}`;
  } catch (error) {
    console.error("Error executing read command:", error);
    return "I encountered an error while processing your request.";
  }
}

/**
 * Handle write commands (fix, implement, add, etc.)
 */
async function handleWriteCommand(
  context: GitHubContext,
  command: ParsedCommand
): Promise<string> {
  // Build context for the query
  const prompt = buildWritePrompt(context, command);

  try {
    const result = await executeQuery(prompt, "write");
    return result.success ? result.result : `Error: ${result.error}`;
  } catch (error) {
    console.error("Error executing write command:", error);
    return "I encountered an error while processing your request.";
  }
}

/**
 * Build a prompt for read-only commands
 */
function buildReadPrompt(
  context: GitHubContext,
  command: ParsedCommand
): string {
  return `
Context:
- Repository: ${context.owner}/${context.repo}
- Issue/PR: #${context.issueNumber}
- Type: ${context.isPR ? "Pull Request" : "Issue"}

Command: ${command.action} ${command.target}

Please provide a helpful response based on this context.
  `.trim();
}

/**
 * Build a prompt for write commands
 */
function buildWritePrompt(
  context: GitHubContext,
  command: ParsedCommand
): string {
  return `
Context:
- Repository: ${context.owner}/${context.repo}
- Issue/PR: #${context.issueNumber}
- Type: ${context.isPR ? "Pull Request" : "Issue"}

Command: ${command.action} ${command.target}

Please implement the requested changes. Use git to create a branch, make changes, and commit them.
  `.trim();
}

/**
 * Post a response comment
 */
export async function postResponse(
  context: GitHubContext,
  response: string
): Promise<void> {
  const octokit = createOctokit(process.env.GITHUB_TOKEN || "");

  await octokit.rest.issues.createComment({
    owner: context.owner,
    repo: context.repo,
    issue_number: context.issueNumber,
    body: response,
  });
}
