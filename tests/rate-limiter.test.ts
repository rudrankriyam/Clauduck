import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitHubRateLimiter } from "../src/github/rate-limiter.js";

describe("GitHubRateLimiter", () => {
  let limiter: GitHubRateLimiter;

  beforeEach(() => {
    limiter = new GitHubRateLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("updates state from headers", () => {
    limiter.updateFromHeaders({
      "x-ratelimit-remaining": "42",
      "x-ratelimit-reset": "100",
    });

    const status = limiter.getStatus();
    expect(status.remaining).toBe(42);
    expect(status.resetAt.getTime()).toBe(100 * 1000);
  });

  it("waits for rate limit reset window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const sleepSpy = vi
      .spyOn(limiter as unknown as { sleep: (ms: number) => Promise<void> }, "sleep")
      .mockResolvedValue();

    limiter.updateFromHeaders({
      "x-ratelimit-reset": "1",
    });

    await limiter.waitIfNeeded();

    expect(sleepSpy).toHaveBeenCalledWith(2000);
    const status = limiter.getStatus();
    expect(status.remaining).toBe(5000);
  });

  it("retries on rate limit 403 with retry-after header", async () => {
    const sleepSpy = vi
      .spyOn(limiter as unknown as { sleep: (ms: number) => Promise<void> }, "sleep")
      .mockResolvedValue();

    const apiCall = vi
      .fn()
      .mockRejectedValueOnce({
        status: 403,
        headers: { "x-ratelimit-remaining": "0", "retry-after": "1" },
      })
      .mockResolvedValueOnce({
        data: "ok",
        headers: { "x-ratelimit-remaining": "4999" },
      });

    const result = await limiter.executeWithRetry(apiCall, 1);

    expect(result).toBe("ok");
    expect(apiCall).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledWith(1000);
  });

  it("throws on 403 without rate limit headers", async () => {
    const apiCall = vi.fn().mockRejectedValue({
      status: 403,
      headers: {},
    });

    await expect(limiter.executeWithRetry(apiCall, 1)).rejects.toMatchObject({
      status: 403,
    });
    expect(apiCall).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 secondary rate limit", async () => {
    const sleepSpy = vi
      .spyOn(limiter as unknown as { sleep: (ms: number) => Promise<void> }, "sleep")
      .mockResolvedValue();
    vi.spyOn(Math, "random").mockReturnValue(0);

    const apiCall = vi
      .fn()
      .mockRejectedValueOnce({
        status: 429,
      })
      .mockResolvedValueOnce({
        data: "ok",
        headers: { "x-ratelimit-remaining": "4999" },
      });

    const result = await limiter.executeWithRetry(apiCall, 1);

    expect(result).toBe("ok");
    expect(apiCall).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledWith(5000);
  });

  it("increases delay when remaining is low", async () => {
    const apiCall = vi.fn().mockResolvedValue({
      data: "ok",
      headers: { "x-ratelimit-remaining": "50" },
    });

    await limiter.executeWithRetry(apiCall, 0);

    const status = limiter.getStatus();
    expect(status.delay).toBe(200);
  });
});
