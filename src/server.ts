/**
 * Clauduck - GitHub Bot with Claude Agent SDK
 *
 * Express server with webhook handlers for GitHub events
 */

import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import dotenv from "dotenv";

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
  // Require signature when secret is configured
  if (!WEBHOOK_SECRET) {
    console.warn("Webhook secret not configured - skipping verification");
    return true; // Allow in development if no secret set
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
      issue?: { number: number };
      pull_request?: { number: number };
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

  // Check for @clauduck mention (case-insensitive, handle [bot])
  const mentionPattern = /@clauduck(\[[a-z]+\])?/gi;
  if (mentionPattern.test(comment.body)) {
    console.log(`Found @clauduck mention in issue #${issue.number}`);
    // TODO: Connect to command processing
  }
}

/**
 * Handle new issues - auto-greet
 */
async function handleIssueOpened(payload: {
  action?: string;
  issue?: { number: number };
  repository?: { full_name: string; name: string; owner: { login: string } };
  sender?: { type: string };
}) {
  const { issue, repository, sender } = payload;
  if (!issue || !repository || !sender) return;

  // Skip if bot and if not a new issue
  if (sender.type === "Bot" || payload.action !== "opened") return;

  console.log(`New issue #${issue.number} in ${repository.full_name}`);
}

/**
 * Handle new PRs
 */
async function handlePROpened(payload: {
  action?: string;
  pull_request?: { number: number };
  repository?: { full_name: string; name: string; owner: { login: string } };
  sender?: { type: string };
}) {
  const { pull_request, repository, sender } = payload;
  if (!pull_request || !repository || !sender) return;

  // Skip if bot and if not a new PR
  if (sender.type === "Bot" || payload.action !== "opened") return;

  console.log(`New PR #${pull_request.number} in ${repository.full_name}`);
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
