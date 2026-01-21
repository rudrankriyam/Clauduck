/**
 * Clauduck - Rate Limiter with Exponential Backoff
 *
 * Handles GitHub API rate limiting with automatic backoff
 */

import type { GitHubApiHeaders } from "../utils/types.js";

interface RateLimitState {
  remaining: number;
  resetAt: number; // Unix timestamp in seconds
  lastRequest: number;
}

/**
 * Error type for GitHub API errors
 */
interface GitHubApiError extends Error {
  status?: number;
  headers?: GitHubApiHeaders;
}

/**
 * GitHub API rate limiter
 * Implements exponential backoff for 403/rate limit responses
 */
export class GitHubRateLimiter {
  private state: RateLimitState = {
    remaining: 5000, // Default GitHub API allowance
    resetAt: 0,
    lastRequest: 0,
  };

  private minDelay: number = 100; // Minimum delay between requests (ms)
  private max: number = 60000; //Delay Maximum delay (60 seconds)

  /**
   * Update rate limit state from GitHub response headers
   */
  updateFromHeaders(headers: GitHubApiHeaders): void {
    if (headers["x-ratelimit-remaining"]) {
      this.state.remaining = parseInt(headers["x-ratelimit-remaining"], 10);
    }
    if (headers["x-ratelimit-reset"]) {
      this.state.resetAt = parseInt(headers["x-ratelimit-reset"], 10);
    }
    this.state.lastRequest = Date.now();
  }

  /**
   * Check if we should wait before making a request
   */
  async waitIfNeeded(): Promise<void> {
    const now = Date.now();

    // Check if we're in a rate limit reset window
    if (this.state.resetAt > 0) {
      const resetIn = this.state.resetAt * 1000 - now;
      if (resetIn > 0) {
        console.warn(`Rate limit reset in ${Math.ceil(resetIn / 1000)}s, waiting...`);
        await this.sleep(resetIn + 1000); // Wait for reset + buffer
        this.state.resetAt = 0;
        this.state.remaining = 5000;
      }
    }

    // Enforce minimum delay between requests
    const timeSinceLastRequest = now - this.state.lastRequest;
    if (timeSinceLastRequest < this.minDelay) {
      await this.sleep(this.minDelay - timeSinceLastRequest);
    }
  }

  /**
   * Calculate delay for retry with exponential backoff
   */
  calculateRetryDelay(attempt: number, baseDelay: number = 1000): number {
    // Exponential backoff: base * 2^attempt with jitter
    const exponential = baseDelay * Math.pow(2, attempt);
    const jitter = exponential * 0.1 * Math.random(); // 10% jitter
    return Math.min(exponential + jitter, this.max);
  }

  /**
   * Execute an API call with rate limit handling and retries
   */
  async executeWithRetry<T>(
    apiCall: () => Promise<{ data: T; headers: GitHubApiHeaders }>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: GitHubApiError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Wait if needed before making request
        await this.waitIfNeeded();

        const response = await apiCall();
        this.updateFromHeaders(response.headers);

        // If we're running low on rate limit, slow down
        if (this.state.remaining < 100) {
          this.minDelay = Math.min(this.minDelay * 2, 1000);
          console.warn(`Rate limit low (${this.state.remaining}), increasing delay to ${this.minDelay}ms`);
        }

        return response.data as T;
      } catch (error: unknown) {
        const typedError = error as GitHubApiError;
        lastError = typedError;

        // Check for rate limit error (403)
        if (typedError.status === 403 || typedError.message?.includes("rate limit")) {
          const retryAfter = typedError.headers?.["retry-after"]
            ? parseInt(typedError.headers["retry-after"], 10) * 1000
            : this.calculateRetryDelay(attempt);

          console.warn(`Rate limited, waiting ${Math.round(retryAfter / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1})`);
          await this.sleep(retryAfter);
          continue;
        }

        // Check for secondary rate limit
        if (typedError.message?.includes("secondary rate limit") || typedError.status === 429) {
          const retryAfter = this.calculateRetryDelay(attempt, 5000);
          console.warn(`Secondary rate limit, waiting ${Math.round(retryAfter / 1000)}s (attempt ${attempt + 1}/${maxRetries + 1})`);
          await this.sleep(retryAfter);
          continue;
        }

        // Non-rate-limit error, don't retry
        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current rate limit status
   */
  getStatus(): { remaining: number; resetAt: Date; delay: number } {
    return {
      remaining: this.state.remaining,
      resetAt: new Date(this.state.resetAt * 1000),
      delay: this.minDelay,
    };
  }

  /**
   * Reset rate limiter (for new installations)
   */
  reset(): void {
    this.state = {
      remaining: 5000,
      resetAt: 0,
      lastRequest: 0,
    };
    this.minDelay = 100;
  }
}

// Singleton instance for shared rate limiting
export const rateLimiter = new GitHubRateLimiter();
