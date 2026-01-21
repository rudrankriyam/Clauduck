/**
 * Clauduck - Comment Polling
 *
 * Polls for new comments during processing to detect:
 * - Stop/cancel commands
 * - New instructions from the user
 */

import { createOctokit } from "../github/client.js";

/**
 * Checkpoint configuration
 */
export interface Checkpoint {
  commentId: number;
  triggeredAt: string;
}

/**
 * Poll result
 */
export interface PollResult {
  hasNewComments: boolean;
  stopRequested: boolean;
  newComments: CommentInfo[];
  commentSummary: string;
}

/**
 * Comment information
 */
export interface CommentInfo {
  id: number;
  user: string;
  body: string;
  createdAt: string;
}

/**
 * Stop/cancel keywords - compiled regex with word boundaries
 * Avoids false positives like "unstoppable" triggering "stop"
 */
const STOP_KEYWORD_PATTERN = /\b(stop|cancel|abort|halt|kill)\b/i;

/**
 * Poll for new comments since a checkpoint
 */
export async function pollForComments(
  owner: string,
  repo: string,
  issueNumber: number,
  checkpoint: Checkpoint
): Promise<PollResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN not configured");
    return {
      hasNewComments: false,
      stopRequested: false,
      newComments: [],
      commentSummary: "",
    };
  }

  const octokit = createOctokit(token);

  try {
    // Fetch all comments on the issue/PR
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    });

    // Filter for new comments
    const newComments = comments.filter((comment) => {
      // Must be after the triggering comment
      if (comment.id <= checkpoint.commentId) return false;

      // Must not be from a bot
      if (comment.user?.type === "Bot") return false;

      // Must not be from Clauduck itself
      if (comment.user?.login?.includes("clauduck")) return false;

      return true;
    });

    // Check for stop commands using regex
    const stopRequested = newComments.some((comment) =>
      STOP_KEYWORD_PATTERN.test(comment.body || "")
    );

    // Build comment summary
    const commentSummary = newComments
      .map((c) => `${c.user?.login}: ${(c.body || "").slice(0, 100)}`)
      .join(" | ");

    return {
      hasNewComments: newComments.length > 0,
      stopRequested,
      newComments: newComments.map((c) => ({
        id: c.id,
        user: c.user?.login || "unknown",
        body: c.body || "",
        createdAt: c.created_at,
      })),
      commentSummary,
    };
  } catch (error) {
    console.error("Error polling for comments:", error);
    return {
      hasNewComments: false,
      stopRequested: false,
      newComments: [],
      commentSummary: "",
    };
  }
}

/**
 * Wait for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll with interval until stop or timeout
 */
export async function pollWithInterval(
  owner: string,
  repo: string,
  issueNumber: number,
  checkpoint: Checkpoint,
  intervalMs: number = 5000,
  maxDurationMs: number = 300000
): Promise<PollResult> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxDurationMs) {
    const result = await pollForComments(owner, repo, issueNumber, checkpoint);

    if (result.stopRequested || result.hasNewComments) {
      return result;
    }

    await sleep(intervalMs);
  }

  // Timeout reached
  return {
    hasNewComments: false,
    stopRequested: false,
    newComments: [],
    commentSummary: "",
  };
}

/**
 * Check if a comment is a stop command
 */
export function isStopCommand(commentBody: string): boolean {
  return STOP_KEYWORD_PATTERN.test(commentBody);
}

/**
 * Create a checkpoint from a triggering comment
 */
export function createCheckpoint(commentId: number, triggeredAt: string): Checkpoint {
  return {
    commentId,
    triggeredAt,
  };
}
