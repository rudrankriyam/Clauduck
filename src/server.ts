/**
 * Clauduck - GitHub Bot with Claude Agent SDK
 *
 * Express server with webhook handlers for GitHub events
 * Uses GitHub App for per-repository installation tokens
 */

import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";

import { postComment, isCollaborator, isOwner } from "./github/client.js";
import {
  getAuthOctokit,
  isGitHubAppConfigured,
  checkPartialAppConfig,
} from "./github/app.js";
import { isStopCommand, parseCommand } from "./commands/parser.js";
import { executeSessionQuery, clearSession } from "./agent/client.js";
import { GitHubContext, CommandMode, GitHubWebhookPayload } from "./utils/types.js";
import { parseWebhookPayload, verifyWebhookSignature } from "./utils/webhook.js";

dotenv.config();

export const app = express();
const PORT = process.env.PORT || 3000;

// Job queue for async webhook processing
interface WebhookJob {
  id: string;
  event: string;
  payload: GitHubWebhookPayload;
  createdAt: number;
}
const jobQueue: Map<string, WebhookJob> = new Map();
const processingJobs: Set<string> = new Set();

// Deduplication window: 5 seconds
const DEDUP_WINDOW_MS = 5000;

/**
 * Process webhook job asynchronously
 */
async function processWebhookJob(job: WebhookJob): Promise<void> {
  const { event, payload } = job;

  try {
    switch (event) {
      case "issue_comment":
        await handleIssueComment(payload);
        break;
      case "issues":
        await handleIssueOpened(payload);
        break;
      case "pull_request":
        await handlePROpened(payload);
        break;
      default:
        console.log(`Ignoring event: ${event}`);
    }
  } catch (error) {
    console.error(`Error processing webhook job ${job.id}:`, error);
  } finally {
    processingJobs.delete(job.id);
    jobQueue.delete(job.id);
  }
}

/**
 * Add job to queue with deduplication
 */
function enqueueJob(event: string, payload: GitHubWebhookPayload, deliveryId: string): void {
  const now = Date.now();
  const jobId = `${deliveryId}`;

  // Check if already processing this delivery
  if (processingJobs.has(jobId)) {
    console.log(`Job ${jobId} already processing, skipping`);
    return;
  }

  // Check for recent duplicate
  const existingJob = jobQueue.get(jobId);
  if (existingJob && (now - existingJob.createdAt) < DEDUP_WINDOW_MS) {
    console.log(`Recent duplicate ${jobId} detected, skipping`);
    return;
  }

  // Add new job
  const job: WebhookJob = {
    id: jobId,
    event,
    payload,
    createdAt: now,
  };
  jobQueue.set(jobId, job);
  processingJobs.add(jobId);

  // Process asynchronously
  console.log(`Queued job ${jobId} for ${event}`);
  processWebhookJob(job).catch(console.error);
}


/**
 * Build GitHub context from webhook payload
 */
function buildGitHubContext(
  repoFullName: string,
  owner: string,
  issueNumber: number,
  isPR: boolean,
  commentId?: number
): GitHubContext {
  const [repoOwner, repo] = repoFullName.split("/");
  return {
    owner: repoOwner || owner,
    repo,
    issueNumber,
    isPR,
    commentId,
    triggeredAt: new Date().toISOString(),
  };
}

/**
 * Sanitize error message for public display
 * Removes internal paths, stack traces, and sensitive info
 */
function sanitizeError(message: string): string {
  // Remove file paths (Unix and Windows)
  let sanitized = message.replace(/\/[\w\/.-]+/g, "[path]");
  sanitized = sanitized.replace(/[A-Za-z]:\\[\w\\.-]+/g, "[path]");

  // Remove error codes and hex dumps
  sanitized = sanitized.replace(/0x[0-9a-fA-F]+/g, "[hex]");
  sanitized = sanitized.replace(/ERR_[\w]+/g, "[error]");

  // Truncate if still too long
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 500) + "...";
  }

  return sanitized;
}

/**
 * Process a @clauduck command and post result back to GitHub
 */
async function processCommand(
  context: GitHubContext,
  commandText: string,
  payload: GitHubWebhookPayload
): Promise<void> {
  let octokit: import("@octokit/rest").Octokit | null = null;
  let hadToken = false;

  try {
    // Get authenticated Octokit client
    const authResult = await getAuthOctokit(payload);
    octokit = authResult.octokit;

    // Set GitHub token for agent subprocess (installation-scoped, limited permissions)
    process.env.GH_TOKEN = authResult.token;
    hadToken = true;
    console.log(`[SERVER] GH_TOKEN set for agent (installation token, scoped to repo)`);

    // Post acknowledgment
    await postComment(
      octokit,
      context.owner,
      context.repo,
      context.issueNumber,
      "Clauduck is processing your request..."
    );

    // Parse command
    const parsed = parseCommand(commandText);
    if (!parsed) {
      await postComment(
        octokit,
        context.owner,
        context.repo,
        context.issueNumber,
        "I couldn't parse your command. Try `@clauduck help` for available commands."
      );
      return;
    }

    // Build prompt based on command
    const prompt = buildPrompt(context, parsed);

    // Execute based on mode
    console.log(`[SERVER] Calling executeSessionQuery...`);
    const result = await executeSessionQuery(context, prompt, parsed.mode, parsed.provider);
    console.log(`[SERVER] executeSessionQuery returned, success: ${result.success}`);

    if (result.success) {
      console.log(`[SERVER] Posting success response...`);
      const response = formatResponse(context, parsed, result.result);
      console.log(`[SERVER] Response length: ${response.length}`);
      await postComment(
        octokit,
        context.owner,
        context.repo,
        context.issueNumber,
        response
      );
      console.log(`[SERVER] Comment posted!`);
    } else {
      console.log(`[SERVER] Posting error response...`);
      await postComment(
        octokit,
        context.owner,
        context.repo,
        context.issueNumber,
        `Error: ${sanitizeError(result.error || "Unknown error")}`
      );
      console.log(`[SERVER] Error comment posted`);
    }
  } catch (error) {
    console.error("Command processing error:", error);
    if (octokit) {
      try {
        await postComment(
          octokit,
          context.owner,
          context.repo,
          context.issueNumber,
          `Error processing command: ${sanitizeError(error instanceof Error ? error.message : "Unknown error")}`
        );
      } catch {
        console.error("Failed to post error comment");
      }
    } else {
      // Auth failed, can't post error comment
      console.error("Auth failed, could not post error comment to GitHub");
    }
  } finally {
    // Clean up token from environment (security best practice)
    if (hadToken) {
      delete process.env.GH_TOKEN;
      console.log(`[SERVER] GH_TOKEN cleaned up`);
    }
  }
}

/**
 * Handle stop/cancel commands
 */
async function handleStopCommand(context: GitHubContext, payload: GitHubWebhookPayload): Promise<void> {
  clearSession(context);

  try {
    const { octokit } = await getAuthOctokit(payload);
    await postComment(
      octokit,
      context.owner,
      context.repo,
      context.issueNumber,
      "Stopped. Session cleared."
    );
  } catch (error) {
    console.error("Failed to post stop confirmation:", error);
  }
}

/**
 * Build prompt from parsed command
 */
function buildPrompt(
  context: GitHubContext,
  parsed: { action: string; target: string; mode: CommandMode }
): string {
  const baseContext = `You are working on ${context.owner}/${context.repo}, issue #${context.issueNumber}.`;

  switch (parsed.action) {
    case "summarize":
    case "summary":
      return `${baseContext}

Please summarize the codebase or the relevant files related to: ${parsed.target || "the entire repository"}.

Provide a concise overview of what the code does, its key components, and any important patterns.`;

    case "review":
      return `${baseContext}

Please review the code related to: ${parsed.target}.

Focus on:
- Code quality and readability
- Potential bugs or issues
- Performance considerations
- Security concerns
- Suggestions for improvement`;

    case "explain":
      return `${baseContext}

Please explain: ${parsed.target}

Break down the code or concept in a clear, understandable way. Use examples where helpful.`;

    case "implement":
    case "fix":
    case "add":
    case "create":
      return `${baseContext}

The user wants you to: ${parsed.action} ${parsed.target}

Your task:
1. Explore the repository structure to understand the codebase
2. Make the necessary changes
3. Ensure changes are complete and working

When done, your changes will be committed and a PR will be created.`;

    case "help":
      return `${baseContext}

Provide help about using Clauduck. Available commands:
- @clauduck summarize [target] - Summarize code or repository
- @clauduck review [target] - Review code for issues
- @clauduck explain [target] - Explain code or concepts
- @clauduck implement [description] - Implement a feature or fix
- @clauduck fix [description] - Fix a bug
- @clauduck help - Show this help message
- Optional: add \`--provider=claude|codex\` to select the AI backend`;

    default:
      return `${baseContext}

Please help with: ${parsed.target}

${parsed.action !== parsed.target ? `User requested: ${parsed.action}` : ""}`;
  }
}

/**
 * Format response for GitHub (handles long content)
 */
function formatResponse(
  context: GitHubContext,
  parsed: { action: string; target: string; mode: CommandMode },
  result: string
): string {
  // Truncate if too long for GitHub comments
  const maxLength = 15000;
  if (result.length > maxLength) {
    return result.slice(0, maxLength) + "\n\n_(truncated)_";
  }
  return result;
}

/**
 * Raw body parser for webhook signature verification
 */
app.use("/webhook", express.raw({ type: "application/json" }));

/**
 * JSON parser for other routes
 */
app.use(express.json());

/**
 * Health check endpoint
 */
app.get("/", (_req: Request, res: Response) => {
  res.json({
    name: "Clauduck",
    status: "running",
    version: "1.0.0",
    githubApp: isGitHubAppConfigured(),
  });
});

/**
 * Webhook endpoint - receives GitHub events
 */
app.post("/webhook", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    const event = req.headers["x-github-event"];
    const deliveryId = req.headers["x-github-delivery"];

    const signatureStr = Array.isArray(signature) ? signature[0] : (signature || "");
    const eventStr = Array.isArray(event) ? event[0] : (event || "");
    const deliveryIdStr = Array.isArray(deliveryId) ? deliveryId[0] : (deliveryId || `unknown-${Date.now()}`);

    const payloadString = req.body.toString();
    if (!verifyWebhookSignature(payloadString, signatureStr)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const parseResult = parseWebhookPayload(payloadString);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }

    const payload = parseResult.data as GitHubWebhookPayload;

    console.log(`Received event: ${eventStr} (delivery: ${deliveryIdStr})`);

    if (payload.action && !["created", "opened"].includes(payload.action)) {
      res.status(200).json({ status: "ignored" });
      return;
    }

    // Queue job for async processing and return immediately
    if (["issue_comment", "issues", "pull_request"].includes(eventStr)) {
      enqueueJob(eventStr, payload, deliveryIdStr);
    } else {
      console.log(`Ignoring event: ${eventStr}`);
    }

    res.status(200).json({ status: "queued" });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Handle new issue comments
 */
async function handleIssueComment(payload: {
  comment?: { body: string; id: number };
  issue?: { number: number };
  repository?: { full_name: string; name: string; owner: { login: string } };
  sender?: { type: string; login?: string };
  installation?: { id: number };
}) {
  const { comment, issue, repository, sender } = payload;
  console.log(`[WEBHOOK] handleIssueComment called`);
  console.log(`[WEBHOOK] comment: ${comment?.body?.slice(0, 50)}...`);
  console.log(`[WEBHOOK] sender: ${sender?.login}, type: ${sender?.type}`);

  if (!comment || !issue || !repository || !sender) {
    console.log(`[WEBHOOK] Missing required fields, returning`);
    return;
  }

  if (sender.type === "Bot") {
    console.log("Skipping bot comment");
    return;
  }

  // Check comment size limit (10KB max)
  const MAX_COMMENT_SIZE = 10 * 1024;
  if (comment.body.length > MAX_COMMENT_SIZE) {
    console.log(`Comment too large (${comment.body.length} bytes), skipping`);
    return;
  }

  // Check if sender is owner or collaborator
  const senderLogin = sender.login;
  if (!senderLogin) {
    console.log("Skipping comment with unknown sender");
    return;
  }

  console.log(`[WEBHOOK] Getting auth octokit...`);
  const { octokit } = await getAuthOctokit(payload);
  console.log(`[WEBHOOK] Got octokit`);

  const repoOwner = repository.owner.login;

  if (!isOwner(repoOwner, senderLogin) && !(await isCollaborator(octokit, repoOwner, repository.name, senderLogin))) {
    console.log(`Skipping non-collaborator @${senderLogin}`);
    return;
  }

  const context = buildGitHubContext(
    repository.full_name,
    repository.owner.login,
    issue.number,
    false,
    comment.id
  );

  const mentionPattern = /@clauduck(?:\[[a-z]+\])?(?![\w-])/gi;
  if (mentionPattern.test(comment.body)) {
    console.log(`Found @clauduck mention in issue #${issue.number}`);

    const commandText = comment.body.replace(mentionPattern, "").trim();
    console.log(`[WEBHOOK] Command: "${commandText}"`);

    if (isStopCommand(commandText)) {
      await handleStopCommand(context, payload);
      return;
    }

    console.log(`[WEBHOOK] Calling processCommand...`);
    await processCommand(context, commandText, payload);
    console.log(`[WEBHOOK] processCommand returned`);
  } else {
    console.log(`[WEBHOOK] No @clauduck mention found`);
  }
}

/**
 * Handle new issues - auto-greet
 */
async function handleIssueOpened(payload: {
  action?: string;
  issue?: { number: number; title?: string };
  repository?: { full_name: string; name: string; owner: { login: string } };
  sender?: { type: string };
  installation?: { id: number };
}) {
  const { issue, repository, sender } = payload;
  if (!issue || !repository || !sender) return;

  if (sender.type === "Bot" || payload.action !== "opened") return;

  console.log(`New issue #${issue.number} in ${repository.full_name}`);

  try {
    const { octokit } = await getAuthOctokit(payload);
    await postComment(
      octokit,
      repository.owner.login,
      repository.name,
      issue.number,
      `Hi! I'm Clauduck, an AI assistant for this repository.

I can help you with:
- **Summarize**: Explain the codebase or specific files
- **Review**: Review code for issues and improvements
- **Explain**: Break down code or concepts
- **Implement**: Help implement features or fixes

Just @mention me with a command, e.g., \`@clauduck summarize the project structure\``
    );
  } catch (error) {
    console.error("Error posting greeting:", error);
  }
}

/**
 * Handle new PRs
 */
async function handlePROpened(payload: {
  action?: string;
  pull_request?: { number: number; title?: string };
  repository?: { full_name: string; name: string; owner: { login: string } };
  sender?: { type: string };
  installation?: { id: number };
}) {
  const { pull_request, repository, sender } = payload;
  if (!pull_request || !repository || !sender) return;

  if (sender.type === "Bot" || payload.action !== "opened") return;

  console.log(`New PR #${pull_request.number} in ${repository.full_name}`);

  try {
    const { octokit } = await getAuthOctokit(payload);
    await postComment(
      octokit,
      repository.owner.login,
      repository.name,
      pull_request.number,
      `Hi! I'm Clauduck, an AI assistant for this repository.

I can help you review this PR. Just @mention me with \`@clauduck review\` and I'll analyze the changes.`
    );
  } catch (error) {
    console.error("Error posting PR greeting:", error);
  }
}

/**
 * Error handling middleware
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Error:", err);
  res.status(500).json({ error: err.message });
});

/**
 * Start the server
 */
export function startServer(): void {
  // Log partial config warning if applicable
  const partialWarning = checkPartialAppConfig();
  if (partialWarning) {
    console.warn(partialWarning);
  }

  const port = parseInt(PORT.toString(), 10);
  app.listen(port, () => {
    console.log(`=== Clauduck ===`);
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Webhook endpoint: http://localhost:${port}/webhook`);
    console.log(`GitHub App: ${isGitHubAppConfigured() ? "configured" : "not configured (using PAT)"}`);
    console.log();
    console.log("Ready to receive GitHub events!");
  });
}
