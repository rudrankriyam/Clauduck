/**
 * Clauduck - Type Definitions
 */

/**
 * Command types for Clauduck
 */
export type CommandMode = "read" | "write";

/**
 * Parsed command from @clauduck mention
 */
export interface ParsedCommand {
  mode: CommandMode;
  action: string;
  target: string;
  original: string;
}

/**
 * Context for processing a GitHub event
 */
export interface GitHubContext {
  owner: string;
  repo: string;
  issueNumber: number;
  isPR: boolean;
  commentId?: number;
  triggeredAt: string;
}

/**
 * Claude Agent response
 */
export interface AgentResponse {
  result: string;
  success: boolean;
  error?: string;
}
