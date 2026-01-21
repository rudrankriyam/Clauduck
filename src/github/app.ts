/**
 * Clauduck - GitHub App Authentication
 *
 * Handles GitHub App JWT creation and installation token generation
 */

import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import type { GitHubWebhookPayload } from "../utils/types.js";

/**
 * GitHub App configuration
 */
export interface AppConfig {
  appId: string;
  privateKey: string;
  webhookSecret?: string;
}

/**
 * Create a GitHub App authenticator
 */
function createAuth(appConfig: AppConfig) {
  // Handle escaped newlines in private key
  const formattedPrivateKey = appConfig.privateKey.replace(/\\n/g, "\n");

  return createAppAuth({
    appId: appConfig.appId,
    privateKey: formattedPrivateKey,
  });
}

/**
 * Get an Octokit client for a specific installation
 * Returns an authenticated Octokit instance ready to use
 */
export async function getInstallationOctokit(
  appConfig: AppConfig,
  installationId: number
): Promise<Octokit> {
  const auth = createAuth(appConfig);

  // Get installation access token
  const { token } = await auth({
    type: "installation",
    installationId,
  });

  return new Octokit({
    auth: token,
    userAgent: "Clauduck/1.0",
  });
}

/**
 * Get authenticated Octokit for installation (GitHub App required)
 */
export async function getAuthOctokit(
  payload: GitHubWebhookPayload
): Promise<{ octokit: Octokit; installationId: number | null; token: string }> {
  const installationId = getInstallationId(payload);
  const appConfig = getGitHubAppConfig();

  if (!appConfig) {
    throw new Error(
      "GitHub App not configured. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_WEBHOOK_SECRET. " +
      "PAT mode is not supported."
    );
  }

  if (!installationId) {
    throw new Error(
      "No installation found in webhook payload. Install the GitHub App on the repository."
    );
  }

  const auth = createAuth(appConfig);
  const { token } = await auth({
    type: "installation",
    installationId,
  });

  const octokit = new Octokit({
    auth: token,
    userAgent: "Clauduck/1.0",
  });

  return { octokit, installationId, token };
}

/**
 * Get installation ID from webhook payload
 */
export function getInstallationId(payload: GitHubWebhookPayload): number | null {
  return payload.installation?.id || null;
}

/**
 * Check if the app is installed on the repository
 */
export function isInstalled(payload: GitHubWebhookPayload): boolean {
  return !!payload.installation;
}

/**
 * Check for partial GitHub App config (some but not all env vars set)
 * Returns null if fully configured, warning message if partial, empty if none set
 */
export function checkPartialAppConfig(): string | null {
  const hasAppId = !!process.env.GITHUB_APP_ID;
  const hasPrivateKey = !!process.env.GITHUB_APP_PRIVATE_KEY;
  const hasWebhookSecret = !!process.env.GITHUB_APP_WEBHOOK_SECRET;
  const hasAny = hasAppId || hasPrivateKey || hasWebhookSecret;
  const hasAll = hasAppId && hasPrivateKey && hasWebhookSecret;

  if (hasAll) return null;
  if (hasAny && !hasAll) {
    const missing = [];
    if (!hasAppId) missing.push("GITHUB_APP_ID");
    if (!hasPrivateKey) missing.push("GITHUB_APP_PRIVATE_KEY");
    if (!hasWebhookSecret) missing.push("GITHUB_APP_WEBHOOK_SECRET");
    return `Warning: Partial GitHub App config. Missing env vars: ${missing.join(", ")}. Will fall back to PAT.`;
  }
  return null;
}

/**
 * Check if GitHub App is fully configured
 */
export function isGitHubAppConfigured(): boolean {
  return !!(
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_PRIVATE_KEY &&
    process.env.GITHUB_APP_WEBHOOK_SECRET
  );
}

/**
 * Create GitHub App config from environment
 */
export function getGitHubAppConfig(): AppConfig | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;

  if (!appId || !privateKey || !webhookSecret) {
    return null;
  }

  return {
    appId,
    privateKey,
    webhookSecret,
  };
}
