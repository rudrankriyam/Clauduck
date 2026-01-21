/**
 * Clauduck - GitHub Bot with Claude Agent SDK
 *
 * Express server with webhook handlers for GitHub events
 */

import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import dotenv from "dotenv";

import { createOctokit, postComment } from "./github/client.js";
import { parseCommand } from "./commands/parser.js";
import { executeSessionQuery, clearSession } from "./agent/client.js";
import { GitHubContext, CommandMode } from "./utils/types.js";

dotenv.config();

export const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

/**
 * Verify GitHub webhook signature (HMAC-SHA256)
 * Returns true only if signature is valid; false for missing/invalid signatures
 */
function verifyWebhookSignature(
  payload: string,
  signature: string | undefined
): boolean {
  // In production, require webhook secret
  if (!WEBHOOK_SECRET) {
    if (process.env.NODE_ENV === "development") {
      console.warn("Webhook secret not configured - skipping verification (development mode)");
      return true;
    }
    console.error("Webhook secret not configured - refusing request in production");
    return false;
  }

  if (!signature) {
    console.error("Missing webhook signature");
    return false;
  }

  const expectedSignature = `sha256=${crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(payload)
    .digest("hex")}`;

  // Check length first to prevent timing attack via length mismatch
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
    return { success: true, data };
  } catch {
    return { success: false, error: "Invalid JSON payload" };
  }
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
  commandText: string
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN not configured - cannot respond to user");
    // Can't post comment without token, but webhook should still return 200
    return;
  }

  // Post acknowledgment
  const octokit = createOctokit(token);
  await postComment(
    octokit,
    context.owner,
    context.repo,
    context.issueNumber,
    "🤖 Clauduck is processing your request..."
  );

  try {
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
    const cwd = parsed.mode === "write" ? `/tmp/clauduck-repos` : undefined;
    const result = await executeSessionQuery(
      context,
      prompt,
      parsed.mode,
      cwd
    );

    if (result.success) {
      // Format result for GitHub (use details for long responses)
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
    await postComment(
      octokit,
      context.owner,
      context.repo,
      context.issueNumber,
      `❌ Error processing command: ${error instanceof Error ? error.message : "Unknown error"}`
    );
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
 * Handle stop/cancel commands
 */
async function handleStopCommand(context: GitHubContext): Promise<void> {
  clearSession(context);

  const token = process.env.GITHUB_TOKEN;
  if (!token) return;

  const octokit = createOctokit(token);
  await postComment(
    octokit,
    context.owner,
    context.repo,
    context.issueNumber,
    "🛑 Stopped. Session cleared."
  );
}

/**
 * Raw body parser for webhook signature verification
 * IMPORTANT: Must come BEFORE express.json() for webhook events
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
  });
});

/**
 * Webhook endpoint - receives GitHub events
 *
 * Events we care about:
 * - issue_comment.created (when someone mentions @clauduck)
 * - issues.opened (new issues - we can auto-greet)
 * - pull_request.opened (new PRs)
 */
app.post("/webhook", async (req: Request, res: Response) => {
  try {
    const signature = req.headers["x-hub-signature-256"];
    const event = req.headers["x-github-event"];

    // Handle headers as strings
    const signatureStr = Array.isArray(signature) ? signature[0] : signature;
    const eventStr = Array.isArray(event) ? event[0] : event;

    // Verify signature
    const payloadString = req.body.toString();
    if (!verifyWebhookSignature(payloadString, signatureStr)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    // Parse payload with error handling
    const parseResult = parseWebhookPayload(payloadString);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid payload" });
      return;
    }

    const payload = parseResult.data as {
      action?: string;
      comment?: { body: string; id: number };
      issue?: { number: number; title?: string };
      pull_request?: { number: number; title?: string };
      repository?: { full_name: string; name: string; owner: { login: string } };
      sender?: { type: string };
    };

    console.log(`Received event: ${eventStr}`);

    // Only process created/opened events, not edits/closed
    if (payload.action && !["created", "opened"].includes(payload.action)) {
      res.status(200).json({ status: "ignored" });
      return;
    }

    switch (eventStr) {
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
        console.log(`Ignoring event: ${eventStr}`);
    }

    res.status(200).json({ status: "ok" });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Handle new issue comments
 * Look for @clauduck mentions
 */
async function handleIssueComment(payload: {
  comment?: { body: string; id: number };
  issue?: { number: number };
  repository?: { full_name: string; name: string; owner: { login: string } };
  sender?: { type: string };
}) {
  const { comment, issue, repository, sender } = payload;
  if (!comment || !issue || !repository || !sender) return;

  // Skip if bot
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

  // Check for @clauduck mention (case-insensitive, handle [bot])
  const mentionPattern = /@clauduck(\[[a-z]+\])?/gi;
  if (mentionPattern.test(comment.body)) {
    console.log(`Found @clauduck mention in issue #${issue.number}`);

    // Extract command (remove mention)
    const commandText = comment.body.replace(mentionPattern, "").trim();

    // Check for stop/cancel after @clauduck mention
    if (/\b(stop|cancel|abort|halt)\b/i.test(commandText)) {
      await handleStopCommand(context);
      return;
    }

    await processCommand(context, commandText);
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
}) {
  const { issue, repository, sender } = payload;
  if (!issue || !repository || !sender) return;

  // Skip if bot and if not a new issue
  if (sender.type === "Bot" || payload.action !== "opened") return;

  console.log(`New issue #${issue.number} in ${repository.full_name}`);

  const token = process.env.GITHUB_TOKEN;
  if (!token) return;

  try {
    const octokit = createOctokit(token);
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
}) {
  const { pull_request, repository, sender } = payload;
  if (!pull_request || !repository || !sender) return;

  // Skip if bot and if not a new PR
  if (sender.type === "Bot" || payload.action !== "opened") return;

  console.log(`New PR #${pull_request.number} in ${repository.full_name}`);

  const token = process.env.GITHUB_TOKEN;
  if (!token) return;

  try {
    const octokit = createOctokit(token);
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
 * Start the server (call this from index.ts)
 */
export function startServer(): void {
  const port = parseInt(PORT.toString(), 10);
  app.listen(port, () => {
    console.log(`=== Clauduck ===`);
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Webhook endpoint: http://localhost:${port}/webhook`);
    console.log();
    console.log("Ready to receive GitHub events!");
  });
}
