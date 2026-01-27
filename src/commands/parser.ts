/**
 * CodeDuck - Command Parser
 *
 * Parses @codeduck commands from issue comments and determines the action
 */

import type { ParsedCommand, CommandMode, ProviderOverride } from "../utils/types.js";

const MENTION_REGEX = /@codeduck(?:\[bot\])?(?![\w-])/gi;
const MENTION_TEST_REGEX = /@codeduck(?:\[bot\])?(?![\w-])/i;

/**
 * Commands that trigger read-only mode
 */
const READ_COMMANDS = [
  "summarize",
  "review",
  "explain",
  "analyze",
  "help",
  "what",
  "why",
  "how",
];

/**
 * Commands that trigger implementation mode
 */
const WRITE_COMMANDS = [
  "fix",
  "implement",
  "add",
  "create",
  "update",
  "modify",
  "refactor",
  "change",
  "patch",
  "delete",
  "remove",
];

/**
 * Parse a @codeduck command from a comment body
 *
 * Examples:
 * - "@codeduck summarize this"
 * - "@codeduck fix the bug in auth.py"
 * - "@codeduck help"
 * - "@codeduck review this PR"
 */
export function parseCommand(commentBody: string): ParsedCommand | null {
  // Remove @codeduck mention (with or without [bot])
  const command = commentBody.replace(MENTION_REGEX, "").trim();

  if (!command) {
    return null;
  }

  const { cleaned, provider } = extractProviderFlag(command);

  // Extract action and target
  const words = cleaned.toLowerCase().split(/\s+/);
  const action = words[0] || "";
  const target = words.slice(1).join(" ") || "";

  // Determine mode based on action
  const mode = determineMode(action);

  return {
    mode,
    action,
    target,
    original: command,
    provider,
  };
}

/**
 * Determine if a command is read-only or write mode
 */
function determineMode(action: string): CommandMode {
  const lowerAction = action.toLowerCase();

  // Check for write commands first (more specific)
  if (WRITE_COMMANDS.some((cmd) => lowerAction.startsWith(cmd))) {
    return "write";
  }

  // Check for read commands
  if (READ_COMMANDS.some((cmd) => lowerAction.startsWith(cmd))) {
    return "read";
  }

  // Default to read for unknown commands
  return "read";
}

/**
 * Check if a comment body contains a @codeduck mention
 */
export function hasCodeDuckMention(commentBody: string): boolean {
  return MENTION_TEST_REGEX.test(commentBody);
}

/**
 * Extract the full command text after @codeduck
 */
export function extractCommand(commentBody: string): string {
  return commentBody
    .replace(MENTION_REGEX, "")
    .trim();
}

function extractProviderFlag(command: string): { cleaned: string; provider?: ProviderOverride } {
  const match = command.match(/(?:^|\s)--provider(?:=|\s+)([a-zA-Z0-9_-]+)/i);
  if (!match) {
    return { cleaned: command };
  }

  const provider = match[1].toLowerCase() as ProviderOverride;
  const cleaned = command
    .replace(match[0], " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { cleaned, provider };
}

/**
 * Check if command text indicates a stop/cancel request
 */
export function isStopCommand(commandText: string): boolean {
  return /\b(stop|cancel|abort|halt)\b/i.test(commandText);
}

/**
 * Get a human-readable description of the mode
 */
export function getModeDescription(mode: CommandMode): string {
  switch (mode) {
    case "read":
      return "Read-only analysis";
    case "write":
      return "Implementation mode";
    default:
      return "Unknown mode";
  }
}
