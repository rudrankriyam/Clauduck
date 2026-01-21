/**
 * Clauduck - GitHub API Client
 *
 * Octokit-based client for GitHub API operations with rate limiting
 */

import { Octokit } from "@octokit/rest";
import { rateLimiter } from "./rate-limiter.js";
import type { GitHubApiHeaders } from "../utils/types.js";

/**
 * Create an Octokit client with a Personal Access Token
 */
export function createOctokit(token: string): Octokit {
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }
  return new Octokit({
    auth: token,
    userAgent: "Clauduck/1.0",
  });
}

/**
 * Post a comment on an issue or PR (rate-limited)
 */
export async function postComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  await rateLimiter.executeWithRetry(async () => {
    const response = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    return {
      data: response.data,
      headers: response.headers as unknown as GitHubApiHeaders,
    };
  });
}

/**
 * Create a branch (rate-limited)
 */
export async function createBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
  sourceBranch: string
): Promise<void> {
  const refData = await rateLimiter.executeWithRetry(async () => {
    const response = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${sourceBranch}`,
    });

    return {
      data: response.data,
      headers: response.headers as unknown as GitHubApiHeaders,
    };
  });

  await rateLimiter.executeWithRetry(async () => {
    const response = await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: refData.object.sha,
    });

    return {
      data: response.data,
      headers: response.headers as unknown as GitHubApiHeaders,
    };
  });
}

/**
 * Get file contents (rate-limited)
 */
export async function getFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<string | null> {
  try {
    const response = await rateLimiter.executeWithRetry(async () => {
      const result = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });
      return { data: result.data, headers: result.headers as unknown as GitHubApiHeaders };
    }) as { content: string; encoding: string };

    if ("content" in response && response.encoding === "base64") {
      return Buffer.from(response.content, "base64").toString("utf-8");
    }

    throw new Error("Unsupported content type");
  } catch (error) {
    const typedError = error as Error & { status?: number };
    if (typedError instanceof Error && typedError.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Create or update a file (rate-limited)
 */
export async function createOrUpdateFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string
): Promise<void> {
  await rateLimiter.executeWithRetry(async () => {
    const response = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content).toString("base64"),
      branch,
      sha,
    });
    return { data: response.data, headers: response.headers as unknown as GitHubApiHeaders };
  });
}

/**
 * Create a pull request (rate-limited)
 */
export async function createPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string
): Promise<string> {
  const response = await rateLimiter.executeWithRetry(async () => {
    const result = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
    });
    return { data: result.data, headers: result.headers as unknown as GitHubApiHeaders };
  }) as { html_url: string };

  return response.html_url;
}

/**
 * Get the default branch of a repository (rate-limited)
 */
export async function getDefaultBranch(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<string> {
  const response = await rateLimiter.executeWithRetry(async () => {
    const result = await octokit.rest.repos.get({
      owner,
      repo,
    });
    return { data: result.data, headers: result.headers as unknown as GitHubApiHeaders };
  }) as { default_branch: string };

  return response.default_branch || "main";
}

/**
 * Get rate limiter status for monitoring
 */
export function getRateLimitStatus() {
  return rateLimiter.getStatus();
}

/**
 * Reset rate limiter (useful for new installations)
 */
export function resetRateLimiter() {
  rateLimiter.reset();
}
