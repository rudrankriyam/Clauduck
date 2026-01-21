/**
 * Clauduck - GitHub Bot with Claude Agent SDK
 *
 * Express server with webhook handlers for GitHub events
 */

import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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
  const event = req.headers["x-github-event"] as string;
  const payload = JSON.parse(req.body.toString());

  console.log(`Received event: ${event}`);

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

  res.status(200).json({ status: "ok" });
});

/**
 * Handle new issue comments
 * Look for @clauduck mentions
 */
async function handleIssueComment(payload: any) {
  const { comment, issue, repository, sender } = payload;

  // Skip if bot
  if (sender.type === "Bot") {
    console.log("Skipping bot comment");
    return;
  }

  // Check for @clauduck mention
  if (comment.body.includes("@clauduck")) {
    console.log(`Found @clauduck mention in issue #${issue.number}`);
  }
}

/**
 * Handle new issues - auto-greet
 */
async function handleIssueOpened(payload: any) {
  const { issue, repository, sender } = payload;

  // Skip if bot
  if (sender.type === "Bot") return;

  console.log(`New issue #${issue.number} in ${repository.full_name}`);
}

/**
 * Handle new PRs
 */
async function handlePROpened(payload: any) {
  const { pull_request, repository, sender } = payload;

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
 * Start the server
 */
app.listen(PORT, () => {
  console.log(`=== Clauduck ===`);
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log();
  console.log("Ready to receive GitHub events!");
});

export { app };
