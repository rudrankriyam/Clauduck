/**
 * CodeDuck - GitHub API Client
 *
 * Octokit-based client for GitHub API operations
 */

import { Octokit } from "@octokit/rest";

/**
 * Create an Octokit client
 */
export function createOctokit(token: string): Octokit {
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }
  return new Octokit({
    auth: token,
    userAgent: "CodeDuck/1.0",
  });
}

/**
 * Post a comment on an issue or PR
 */
export async function postComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  console.log(`[CLIENT] postComment: owner=${owner}, repo=${repo}, issue=${issueNumber}`);
  const response = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
  console.log(`[CLIENT] Comment created: ${response.data.html_url}`);
}

/**
 * Create a branch
 */
export async function createBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
  sourceBranch: string
): Promise<void> {
  // Get source branch SHA
  const refData = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${sourceBranch}`,
  });

  // Create new branch
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: refData.data.object.sha,
  });
}

/**
 * Get file contents
 */
export async function getFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<string | null> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if ("content" in response.data && response.data.encoding === "base64") {
      return Buffer.from(response.data.content, "base64").toString("utf-8");
    }
    return null;
  } catch (error) {
    const typedError = error as { status?: number };
    if (typedError instanceof Error && typedError.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Create or update a file
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
  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: Buffer.from(content).toString("base64"),
    branch,
    sha,
  });
}

/**
 * Create a pull request
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
  const response = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head,
    base,
  });
  return response.data.html_url;
}

/**
 * Get the default branch of a repository
 */
export async function getDefaultBranch(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<string> {
  const response = await octokit.rest.repos.get({
    owner,
    repo,
  });
  return response.data.default_branch || "main";
}

/**
 * Get rate limiter status for monitoring
 */
export function getRateLimitStatus() {
  return {
    remaining: 5000,
    resetAt: new Date(),
    delay: 100,
  };
}

/**
 * Reset rate limiter
 */
export function resetRateLimiter() {
  // No-op with simplified rate limiting
}

/**
 * Check if a user is a collaborator on a repository
 */
export async function isCollaborator(
  octokit: Octokit,
  owner: string,
  repo: string,
  username: string
): Promise<boolean> {
  try {
    await octokit.repos.checkCollaborator({
      owner,
      repo,
      username,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a user is the repository owner
 */
export function isOwner(owner: string, username: string): boolean {
  return owner === username;
}
