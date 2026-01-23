import type { GitHubApiHeaders, RateLimitStatus } from "../utils/types.js";

const DEFAULT_REMAINING = 5000;
const LOW_REMAINING_THRESHOLD = 100;
const LOW_REMAINING_DELAY_MS = 200;
const SECONDARY_RATE_LIMIT_BASE_DELAY_MS = 5000;

export class GitHubRateLimiter {
  private remaining = DEFAULT_REMAINING;
  private resetAt = new Date(0);
  private delay = 0;

  updateFromHeaders(headers: GitHubApiHeaders): void {
    const remainingHeader = headers["x-ratelimit-remaining"];
    const resetHeader = headers["x-ratelimit-reset"];

    if (remainingHeader !== undefined) {
      const remaining = Number.parseInt(remainingHeader, 10);
      if (!Number.isNaN(remaining)) {
        this.remaining = remaining;
      }
    }

    if (resetHeader !== undefined) {
      const reset = Number.parseInt(resetHeader, 10);
      if (!Number.isNaN(reset)) {
        this.resetAt = new Date(reset * 1000);
      }
      if (remainingHeader === undefined) {
        this.remaining = 0;
      }
    }

    if (this.remaining <= LOW_REMAINING_THRESHOLD) {
      this.delay = LOW_REMAINING_DELAY_MS;
    } else {
      this.delay = 0;
    }
  }

  getStatus(): RateLimitStatus {
    return {
      remaining: this.remaining,
      resetAt: this.resetAt,
      delay: this.delay,
    };
  }

  reset(): void {
    this.remaining = DEFAULT_REMAINING;
    this.resetAt = new Date(0);
    this.delay = 0;
  }

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    if (this.remaining <= 0 && this.resetAt.getTime() > now) {
      const waitMs = this.resetAt.getTime() - now + 1000;
      await this.sleep(waitMs);
      this.remaining = DEFAULT_REMAINING;
      this.delay = 0;
    }
  }

  async executeWithRetry<T>(
    apiCall: () => Promise<{ data: T; headers: GitHubApiHeaders }>,
    maxRetries = 2
  ): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        await this.waitIfNeeded();
        const response = await apiCall();
        this.updateFromHeaders(response.headers || {});
        if (this.delay > 0) {
          await this.sleep(this.delay);
        }
        return response.data;
      } catch (error) {
        attempt += 1;
        const typedError = error as { status?: number; headers?: GitHubApiHeaders };
        const status = typedError.status;
        const headers = typedError.headers || {};

        if (attempt > maxRetries) {
          throw error;
        }

        if (status === 403) {
          const retryAfter = headers["retry-after"];
          const remainingHeader = headers["x-ratelimit-remaining"];
          const resetHeader = headers["x-ratelimit-reset"];

          if (retryAfter) {
            this.updateFromHeaders(headers);
            await this.sleep(Number.parseInt(retryAfter, 10) * 1000);
            continue;
          }

          if (remainingHeader === "0" && resetHeader) {
            this.updateFromHeaders(headers);
            await this.waitIfNeeded();
            continue;
          }

          throw error;
        }

        if (status === 429) {
          this.updateFromHeaders(headers);
          const jitter = Math.floor(Math.random() * SECONDARY_RATE_LIMIT_BASE_DELAY_MS);
          await this.sleep(SECONDARY_RATE_LIMIT_BASE_DELAY_MS + jitter);
          continue;
        }

        throw error;
      }
    }
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const rateLimiter = new GitHubRateLimiter();
