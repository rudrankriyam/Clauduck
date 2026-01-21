/**
 * Clauduck - Implement Mode
 *
 * Handles git workflows for implementing changes:
 * - Clone/checkout repository
 * - Create implementation branch
 * - Commit changes
 * - Push and create PR
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createOctokit, createBranch, createPullRequest } from "../github/client.js";
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
    // Ensure repo directory exists
    if (!existsSync(REPO_BASE_DIR)) {
      mkdirSync(REPO_BASE_DIR, { recursive: true });
    }

    // Clone or update repository
    await ensureRepo(context.owner, context.repo, repoDir);

    // Create implementation branch
    const branchName = createBranchName(context.issueNumber);
    await createBranchInRepo(repoDir, branchName);

    // Build prompt for implementation
    const prompt = buildImplementPrompt(context, command);

    // Execute implementation
    const result = await executeQuery(prompt, "write", repoDir);

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
        result
      );

      return {
        success: true,
        branchName,
        prUrl,
      };
    } else {
      return {
        success: true,
        branchName,
        error: "No changes were made.",
      };
    }
  } catch (error) {
    console.error("Implementation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get the directory path for a repository
 */
function getRepoDir(owner: string, repo: string): string {
  return join(REPO_BASE_DIR, `${owner}-${repo}`);
}

/**
 * Clone or update a repository
 */
async function ensureRepo(
  owner: string,
  repo: string,
  repoDir: string
): Promise<void> {
  if (existsSync(join(repoDir, ".git"))) {
    // Update existing repo
    console.log(`Updating existing repo: ${owner}/${repo}`);
    execSync("git fetch origin", { cwd: repoDir, stdio: "inherit" });
    execSync("git checkout main", { cwd: repoDir, stdio: "inherit" });
    execSync("git pull origin main", { cwd: repoDir, stdio: "inherit" });
  } else {
    // Clone new repo
    console.log(`Cloning new repo: ${owner}/${repo}`);
    execSync(`git clone https://github.com/${owner}/${repo}.git ${repoDir}`, {
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
  branchName: string
): Promise<void> {
  // Get main branch SHA
  const mainSha = execSync("git rev-parse main", {
    cwd: repoDir,
    encoding: "utf-8",
  }).trim();

  // Create branch
  execSync(`git checkout -b ${branchName}`, {
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
 * Commit changes
 */
async function commitChanges(
  repoDir: string,
  issueNumber: number
): Promise<void> {
  execSync("git add -A", { cwd: repoDir, stdio: "inherit" });

  const commitMessage = `feat: Implement issue #${issueNumber}

Automated implementation by Clauduck.`;

  execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
    cwd: repoDir,
    stdio: "inherit",
  });

  console.log("Changes committed");
}

/**
 * Push branch to remote
 */
async function pushBranch(repoDir: string, branchName: string): Promise<void> {
  execSync(`git push -u origin ${branchName}`, {
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
  body: string
): Promise<string> {
  const octokit = createOctokit(process.env.GITHUB_TOKEN || "");

  const prUrl = await createPullRequest(
    octokit,
    owner,
    repo,
    `feat: Implement issue #${issueNumber}`,
    body,
    head
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
