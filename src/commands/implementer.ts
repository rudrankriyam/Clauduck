/**
 * Clauduck - Implement Mode
 *
 * Handles git workflows for implementing changes:
 * - Clone/checkout repository
 * - Create implementation branch
 * - Commit changes
 * - Push and create PR
 */

import { execSync, execFileSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createOctokit, createPullRequest, getDefaultBranch as getRepoDefaultBranch } from "../github/client.js";
import { executeQuery } from "../agent/client.js";
import type { GitHubContext } from "../utils/types.js";

/**
 * Base directory for cloned repositories
 */
const REPO_BASE_DIR = "/tmp/clauduck-repos";

/**
 * Implementation result
 */
export interface ImplementResult {
  success: boolean;
  branchName?: string;
  prUrl?: string;
  error?: string;
  changesMade: boolean;
}

/**
 * Validate repository name to prevent shell injection
 * Allows alphanumeric, hyphens, underscores, and dots (valid in repo names)
 */
function validateRepoName(name: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error(`Invalid repository name: ${name}`);
  }
}

/**
 * Get the directory path for a repository
 */
function getRepoDir(owner: string, repo: string): string {
  validateRepoName(owner);
  validateRepoName(repo);
  return join(REPO_BASE_DIR, `${owner}-${repo}`);
}

/**
 * Implement a change in a repository
 */
export async function implement(
  context: GitHubContext,
  command: string
): Promise<ImplementResult> {
  const repoDir = getRepoDir(context.owner, context.repo);

  try {
    // Validate inputs
    validateRepoName(context.owner);
    validateRepoName(context.repo);

    // Ensure repo directory exists
    if (!existsSync(REPO_BASE_DIR)) {
      mkdirSync(REPO_BASE_DIR, { recursive: true });
    }

    // Get default branch from GitHub API
    const defaultBranch = await getDefaultBranch(context.owner, context.repo);

    // Clone or update repository
    await ensureRepo(context.owner, context.repo, repoDir, defaultBranch);

    // Create implementation branch
    const branchName = createBranchName(context.issueNumber);
    await createBranchInRepo(repoDir, branchName, defaultBranch);

    // Build prompt for implementation
    const prompt = buildImplementPrompt(context, command);

    // Execute implementation
    const result = await executeQuery(prompt, "write");
    if (!result.success) {
      return {
        success: false,
        error: result.error,
        changesMade: false,
      };
    }

    // Check if there are changes to commit
    const hasChanges = checkForChanges(repoDir);

    if (hasChanges) {
      // Commit changes
      await commitChanges(repoDir, context.issueNumber);

      // Push branch
      await pushBranch(repoDir, branchName);

      // Create PR
      const prUrl = await createPR(
        context.owner,
        context.repo,
        branchName,
        context.issueNumber,
        result.result,
        defaultBranch
      );

      return {
        success: true,
        branchName,
        prUrl,
        changesMade: true,
      };
    } else {
      return {
        success: true,
        branchName,
        error: "No changes were made.",
        changesMade: false,
      };
    }
  } catch (error) {
    console.error("Implementation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      changesMade: false,
    };
  }
}

/**
 * Get default branch from GitHub API
 */
async function getDefaultBranch(
  owner: string,
  repo: string
): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return "main"; // Fallback to main
  }

  try {
    const octokit = createOctokit(token);
    return await getRepoDefaultBranch(octokit, owner, repo);
  } catch {
    console.warn(`Failed to get default branch for ${owner}/${repo}, using "main"`);
    return "main";
  }
}

/**
 * Clone or update a repository
 */
async function ensureRepo(
  owner: string,
  repo: string,
  repoDir: string,
  defaultBranch: string
): Promise<void> {
  if (existsSync(join(repoDir, ".git"))) {
    // Update existing repo
    console.log(`Updating existing repo: ${owner}/${repo}`);
    execFileSync("git", ["fetch", "origin"], { cwd: repoDir, stdio: "inherit" });
    execFileSync("git", ["checkout", defaultBranch], { cwd: repoDir, stdio: "inherit" });
    execFileSync("git", ["pull", "origin", defaultBranch], { cwd: repoDir, stdio: "inherit" });
  } else {
    // Clone new repo - use execFileSync to avoid shell injection
    console.log(`Cloning new repo: ${owner}/${repo}`);
    execFileSync("git", ["clone", `https://github.com/${owner}/${repo}.git`, repoDir], {
      stdio: "inherit",
    });
  }
}

/**
 * Create a branch name for implementation
 */
function createBranchName(issueNumber: number): string {
  const timestamp = Date.now().toString(36);
  return `clauduck/issue-${issueNumber}-impl-${timestamp}`;
}

/**
 * Create a branch in the repository
 */
async function createBranchInRepo(
  repoDir: string,
  branchName: string,
  baseBranch: string
): Promise<void> {
  // Create branch from base branch
  execFileSync("git", ["checkout", "-b", branchName, baseBranch], {
    cwd: repoDir,
    stdio: "inherit",
  });

  console.log(`Created branch: ${branchName}`);
}

/**
 * Check if there are uncommitted changes
 */
function checkForChanges(repoDir: string): boolean {
  const status = execSync("git status --porcelain", {
    cwd: repoDir,
    encoding: "utf-8",
  });
  return status.trim().length > 0;
}

/**
 * Commit changes - uses a file for multi-line messages to avoid shell issues
 */
async function commitChanges(
  repoDir: string,
  issueNumber: number
): Promise<void> {
  execSync("git add -A", { cwd: repoDir, stdio: "inherit" });

  // Use a file for the commit message to avoid shell escaping issues
  const commitMessage = `feat: Implement issue #${issueNumber}

Automated implementation by Clauduck.`;

  const tempFile = join(repoDir, ".git", "COMMIT_EDITMSG");
  writeFileSync(tempFile, commitMessage);

  execFileSync("git", ["commit", "--file", tempFile], {
    cwd: repoDir,
    stdio: "inherit",
  });

  console.log("Changes committed");
}

/**
 * Push branch to remote
 */
async function pushBranch(repoDir: string, branchName: string): Promise<void> {
  execFileSync("git", ["push", "-u", "origin", branchName], {
    cwd: repoDir,
    stdio: "inherit",
  });

  console.log(`Branch pushed: ${branchName}`);
}

/**
 * Create a pull request
 */
async function createPR(
  owner: string,
  repo: string,
  head: string,
  issueNumber: number,
  body: string,
  baseBranch: string
): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN not configured");
  }

  const octokit = createOctokit(token);

  const prUrl = await createPullRequest(
    octokit,
    owner,
    repo,
    `feat: Implement issue #${issueNumber}`,
    body,
    head,
    baseBranch
  );

  console.log(`PR created: ${prUrl}`);
  return prUrl;
}

/**
 * Build prompt for implementation
 */
function buildImplementPrompt(
  context: GitHubContext,
  command: string
): string {
  return `
You are working in the repository ${context.owner}/${context.repo}.

Context:
- Issue/PR: #${context.issueNumber}
- Type: ${context.isPR ? "Pull Request" : "Issue"}

Command: ${command}

Your task:
1. Explore the repository structure to understand the codebase
2. Implement the requested changes
3. Make sure your changes are complete and working

Please make the necessary file changes. When done, your changes will be committed and a PR will be created.
  `.trim();
}
