/**
 * Clauduck - Type Definitions
 */

/**
 * Command types for Clauduck
 */
export type CommandMode = "read" | "write";

export type AgentProvider = "claude" | "codex";
export type ProviderOverride = AgentProvider | "minimax" | "anthropic";

/**
 * Parsed command from @clauduck mention
 */
export interface ParsedCommand {
  mode: CommandMode;
  action: string;
  target: string;
  original: string;
  provider?: ProviderOverride;
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

/**
 * GitHub webhook payload for issue_comment events
 */
export interface GitHubWebhookPayload {
  action?: string;
  comment?: {
    body: string;
    id: number;
  };
  issue?: {
    number: number;
    title?: string;
  };
  pull_request?: {
    number: number;
    title?: string;
  };
  repository?: {
    full_name: string;
    name: string;
    owner: {
      login: string;
    };
  };
  sender?: {
    type: string;
  };
  installation?: {
    id: number;
  };
}

/**
 * GitHub API response headers (relevant rate limit fields)
 */
export interface GitHubApiHeaders {
  "x-ratelimit-remaining"?: string;
  "x-ratelimit-reset"?: string;
  "retry-after"?: string;
  [key: string]: string | undefined;
}

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  data: T;
  headers: GitHubApiHeaders;
}

/**
 * Rate limiter status
 */
export interface RateLimitStatus {
  remaining: number;
  resetAt: Date;
  delay: number;
}
