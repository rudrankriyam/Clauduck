import { describe, it, expect, vi, afterEach } from "vitest";
import type { Octokit } from "@octokit/rest";
import { createBranch } from "../src/github/client.js";
import { rateLimiter } from "../src/github/rate-limiter.js";

describe("github client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createBranch uses rate limiter for each API call", async () => {
    const executeSpy = vi
      .spyOn(rateLimiter, "executeWithRetry")
      .mockImplementation(async (fn) => {
        const result = await fn();
        return result.data as unknown as object;
      });

    const octokit = {
      rest: {
        git: {
          getRef: vi.fn().mockResolvedValue({
            data: { object: { sha: "abc123" } },
            headers: {},
          }),
          createRef: vi.fn().mockResolvedValue({
            data: {},
            headers: {},
          }),
        },
      },
    } as unknown as Octokit;

    await createBranch(octokit, "owner", "repo", "feature", "main");

    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(octokit.rest.git.getRef).toHaveBeenCalledTimes(1);
    expect(octokit.rest.git.createRef).toHaveBeenCalledTimes(1);
  });
});
