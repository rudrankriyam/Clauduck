/**
 * Clauduck - GitHub API Client
 *
 * Octokit-based client for GitHub API operations
 */

import { Octokit } from "@octokit/rest";

/**
 * Create an Octokit client with a Personal Access Token
 */
export function createOctokit(token: string): Octokit {
  return new Octokit({
    auth: token,
    userAgent: "Clauduck/1.0",
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
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body,
  });
}

/**
 * Create a branch
 */
export async function createBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
  sourceBranch: string = "main"
): Promise<void> {
  const { data: refData } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${sourceBranch}`,
  });

  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: refData.object.sha,
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
  branch: string = "main"
): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if ("content" in data && data.encoding === "base64") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }

    throw new Error("Unsupported content type");
  } catch (error: any) {
    if (error.status === 404) {
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
  branch: string = "main",
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
  base: string = "main"
): Promise<string> {
  const { data } = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head,
    base,
  });

  return data.html_url;
}
