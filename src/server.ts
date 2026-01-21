/**
 * Clauduck - GitHub Bot with Claude Agent SDK
 *
 * Express server with webhook handlers for GitHub events
 * Uses GitHub App for per-repository installation tokens
 */

import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import dotenv from "dotenv";

import { postComment } from "./github/client.js";
import {
  getAuthOctokit,
  isGitHubAppConfigured,
  checkPartialAppConfig,
} from "./github/app.js";
import { parseCommand } from "./commands/parser.js";
import { executeSessionQuery, clearSession } from "./agent/client.js";
import { GitHubContext, CommandMode, GitHubWebhookPayload } from "./utils/types.js";

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
 * Verify GitHub webhook signature (HMAC-SHA256)
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | undefined
): boolean {
  // Determine which secret to use
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET || process.env.GITHUB_WEBHOOK_SECRET || "";

  // In production, require webhook secret
  if (!webhookSecret) {
    const isDevelopment = process.env.NODE_ENV === "development" || process.env.DEBUG === "true";
    if (isDevelopment) {
      console.warn("Webhook secret not configured - skipping verification (development mode)");
      return true;
    }
    console.error("Webhook secret not configured - refusing request. Set NODE_ENV=development to skip in development.");
    return false;
  }

  if (!signature) {
    console.error("Missing webhook signature");
    return false;
  }

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", webhookSecret)
    .update(payload)
    .digest("hex")}`;

  if (signature.length !== expectedSignature.length) {
    console.error("Invalid signature length");
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    console.error("Signature comparison failed");
    return false;
  }
}

/**
 * Parse and validate webhook payload
 */
function parseWebhookPayload(
  body: string
): { success: boolean; data?: object; error?: string } {
  try {
    const data = JSON.parse(body.toString());

    // Basic schema validation
    if (!validateWebhookSchema(data)) {
      return { success: false, error: "Invalid webhook payload schema" };
    }

    return { success: true, data };
  } catch {
    return { success: false, error: "Invalid JSON payload" };
  }
}

/**
 * Validate webhook payload has required fields
 */
function validateWebhookSchema(data: unknown): data is GitHubWebhookPayload {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const payload = data as Record<string, unknown>;

  // Check for required nested structure if repository exists
  if (payload.repository) {
    const repo = payload.repository as Record<string, unknown>;
    if (typeof repo.full_name !== "string" || typeof repo.owner !== "object") {
      return false;
    }
    const owner = repo.owner as Record<string, unknown>;
    if (typeof owner.login !== "string") {
      return false;
    }
  }

  // For issue_comment events, validate comment and issue
  if (payload.comment && payload.issue) {
    const comment = payload.comment as Record<string, unknown>;
    const issue = payload.issue as Record<string, unknown>;
    if (typeof comment.body !== "string" || typeof comment.id !== "number") {
      return false;
    }
    if (typeof issue.number !== "number") {
      return false;
    }
  }

  // For issues events, validate issue
  if (payload.issue && !payload.comment) {
    const issue = payload.issue as Record<string, unknown>;
    if (typeof issue.number !== "number") {
      return false;
    }
  }

  // For PR events, validate pull_request
  if (payload.pull_request) {
    const pr = payload.pull_request as Record<string, unknown>;
    if (typeof pr.number !== "number") {
      return false;
    }
  }

  return true;
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
 * Process a @clauduck command and post result back to GitHub
 */
async function processCommand(
  context: GitHubContext,
  commandText: string,
  payload: GitHubWebhookPayload
): Promise<void> {
  let octokit: import("@octokit/rest").Octokit | null = null;

  try {
    // Get authenticated Octokit client
    const authResult = await getAuthOctokit(payload);
    octokit = authResult.octokit;

    // Post acknowledgment
    await postComment(
      octokit,
      context.owner,
      context.repo,
      context.issueNumber,
      "🤖 Clauduck is processing your request..."
    );

    // Parse command
    const parsed = parseCommand(commandText);
    if (!parsed) {
      await postComment(
        octokit,
        context.owner,
        context.repo,
        context.issueNumber,
        "❓ I couldn't parse your command. Try `@clauduck help` for available commands."
      );
      return;
    }

    // Build prompt based on command
    const prompt = buildPrompt(context, parsed);

    // Execute based on mode
    const result = await executeSessionQuery(context, prompt, parsed.mode);

    if (result.success) {
      const response = formatResponse(context, parsed, result.result);
      await postComment(
        octokit,
        context.owner,
        context.repo,
        context.issueNumber,
        response
      );
    } else {
      await postComment(
        octokit,
        context.owner,
        context.repo,
        context.issueNumber,
        `❌ Error: ${result.error || "Unknown error"}`
      );
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
          `❌ Error processing command: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      } catch {
        console.error("Failed to post error comment");
      }
    } else {
      // Auth failed, can't post error comment
      console.error("Auth failed, could not post error comment to GitHub");
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
      "🛑 Stopped. Session cleared."
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
- @clauduck help - Show this help message`;

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
  const header = `## Clauduck Response\n\n**Command:** @clauduck ${parsed.action} ${parsed.target}\n\n`;
  const truncated = result.length > 15000 ? result.slice(0, 15000) + "\n\n_(truncated)_" : result;
  const footer = `\n---\n*🤖 Powered by MiniMax M2.1*`;

  return header + truncated + footer;
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
  sender?: { type: string };
  installation?: { id: number };
}) {
  const { comment, issue, repository, sender } = payload;
  if (!comment || !issue || !repository || !sender) return;

  if (sender.type === "Bot") {
    console.log("Skipping bot comment");
    return;
  }

  const context = buildGitHubContext(
    repository.full_name,
    repository.owner.login,
    issue.number,
    false,
    comment.id
  );

  const mentionPattern = /@clauduck(\[[a-z]+\])?/gi;
  if (mentionPattern.test(comment.body)) {
    console.log(`Found @clauduck mention in issue #${issue.number}`);

    const commandText = comment.body.replace(mentionPattern, "").trim();

    if (/\b(stop|cancel|abort|halt)\b/i.test(commandText)) {
      await handleStopCommand(context, payload);
      return;
    }

    await processCommand(context, commandText, payload);
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
      `👋 Hi! I'm Clauduck, an AI assistant for this repository.

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
      `👋 Hi! I'm Clauduck, an AI assistant for this repository.

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
