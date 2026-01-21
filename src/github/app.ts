/**
 * Clauduck - GitHub App Authentication
 *
 * GitHub App implementation using @octokit/app
 */

import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";

/**
 * GitHub App configuration
 */
interface AppConfig {
  appId: number;
  privateKey: string;
  webhookSecret?: string;
}

/**
 * Create a GitHub App instance
 */
export function createApp(config: AppConfig): App {
  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: {
      secret: config.webhookSecret || "",
    },
  });
}

/**
 * Get an Octokit client for a specific installation
 */
export async function getInstallationOctokit(
  app: App,
  installationId: number
): Promise<Octokit> {
  const octokit = await app.getInstallationOctokit(installationId);
  return octokit as unknown as Octokit;
}

/**
 * Get installation ID from webhook payload
 */
export function getInstallationId(payload: any): number | null {
  return payload.installation?.id || null;
}

/**
 * Check if the app is installed on the repository
 */
export function isInstalled(payload: any): boolean {
  return !!payload.installation;
}
