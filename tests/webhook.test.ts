import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import { parseWebhookPayload, verifyWebhookSignature } from "../src/utils/webhook.js";

const payload = JSON.stringify({
  comment: { body: "hello", id: 1 },
  issue: { number: 2 },
  repository: { full_name: "owner/repo", owner: { login: "owner" } },
});

function sign(body: string, secret: string) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("webhook signature verification", () => {
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    env = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts valid signatures", () => {
    env.GITHUB_APP_WEBHOOK_SECRET = "secret";
    const signature = sign(payload, "secret");
    expect(verifyWebhookSignature(payload, signature, env)).toBe(true);
  });

  it("rejects invalid signatures", () => {
    env.GITHUB_APP_WEBHOOK_SECRET = "secret";
    const signature = sign(payload, "wrong-secret");
    expect(verifyWebhookSignature(payload, signature, env)).toBe(false);
  });

  it("rejects missing signature in production", () => {
    env.GITHUB_APP_WEBHOOK_SECRET = "secret";
    expect(verifyWebhookSignature(payload, undefined, env)).toBe(false);
  });

  it("allows missing secret in development", () => {
    env.NODE_ENV = "development";
    expect(verifyWebhookSignature(payload, undefined, env)).toBe(true);
  });

  it("rejects missing secret in production", () => {
    expect(verifyWebhookSignature(payload, undefined, env)).toBe(false);
  });
});

describe("webhook payload validation", () => {
  it("parses valid issue_comment payload", () => {
    const result = parseWebhookPayload(payload);
    expect(result.success).toBe(true);
  });

  it("rejects invalid JSON", () => {
    const result = parseWebhookPayload("{invalid");
    expect(result.success).toBe(false);
  });

  it("rejects payload missing issue number", () => {
    const invalidPayload = JSON.stringify({
      comment: { body: "hello", id: 1 },
      issue: {},
    });
    const result = parseWebhookPayload(invalidPayload);
    expect(result.success).toBe(false);
  });

  it("rejects payload missing pull_request number", () => {
    const invalidPayload = JSON.stringify({
      pull_request: {},
    });
    const result = parseWebhookPayload(invalidPayload);
    expect(result.success).toBe(false);
  });
});
