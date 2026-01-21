/**
 * Clauduck - Command Parser
 *
 * Parses @clauduck commands from issue comments and determines the action
 */

import type { ParsedCommand, CommandMode } from "../utils/types.js";

const MENTION_REGEX = /@clauduck(?:\[bot\])?(?![\w-])/gi;
const MENTION_TEST_REGEX = /@clauduck(?:\[bot\])?(?![\w-])/i;

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
 * Parse a @clauduck command from a comment body
 *
 * Examples:
 * - "@clauduck summarize this"
 * - "@clauduck fix the bug in auth.py"
 * - "@clauduck help"
 * - "@clauduck review this PR"
 */
export function parseCommand(commentBody: string): ParsedCommand | null {
  // Remove @clauduck mention (with or without [bot])
  const command = commentBody
    .replace(MENTION_REGEX, "")
    .trim();

  if (!command) {
    return null;
  }

  // Extract action and target
  const words = command.toLowerCase().split(/\s+/);
  const action = words[0] || "";
  const target = words.slice(1).join(" ") || "";

  // Determine mode based on action
  const mode = determineMode(action);

  return {
    mode,
    action,
    target,
    original: command,
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
 * Check if a comment body contains a @clauduck mention
 */
export function hasClauduckMention(commentBody: string): boolean {
  return MENTION_TEST_REGEX.test(commentBody);
}

/**
 * Extract the full command text after @clauduck
 */
export function extractCommand(commentBody: string): string {
  return commentBody
    .replace(MENTION_REGEX, "")
    .trim();
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
