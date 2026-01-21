/**
 * Webhook helpers for signature verification and payload validation.
 */

import crypto from "crypto";
import type { GitHubWebhookPayload } from "./types.js";

/**
 * Verify GitHub webhook signature (HMAC-SHA256).
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const webhookSecret = env.GITHUB_APP_WEBHOOK_SECRET || env.GITHUB_WEBHOOK_SECRET || "";

  if (!webhookSecret) {
    const isDevelopment = env.NODE_ENV === "development" || env.DEBUG === "true";
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
 * Parse and validate webhook payload.
 */
export function parseWebhookPayload(
  body: string
): { success: boolean; data?: GitHubWebhookPayload; error?: string } {
  try {
    const data = JSON.parse(body.toString());

    if (!validateWebhookSchema(data)) {
      return { success: false, error: "Invalid webhook payload schema" };
    }

    return { success: true, data };
  } catch {
    return { success: false, error: "Invalid JSON payload" };
  }
}

/**
 * Validate webhook payload has required fields.
 */
export function validateWebhookSchema(data: unknown): data is GitHubWebhookPayload {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const payload = data as Record<string, unknown>;

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

  if (payload.issue && !payload.comment) {
    const issue = payload.issue as Record<string, unknown>;
    if (typeof issue.number !== "number") {
      return false;
    }
  }

  if (payload.pull_request) {
    const pr = payload.pull_request as Record<string, unknown>;
    if (typeof pr.number !== "number") {
      return false;
    }
  }

  return true;
}
