import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SessionStore } from "../src/agent/session-store.js";

const silentLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
};

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "clauduck-session-store-"));
}

const baseContext = {
  owner: "owner",
  repo: "repo",
  issueNumber: 1,
  isPR: false,
  triggeredAt: new Date().toISOString(),
};

describe("SessionStore", () => {
  it("persists session files with 0600 permissions", () => {
    const dir = makeTempDir();
    const store = new SessionStore({ dir, ttlMs: 1000, logger: silentLogger });
    const key = "owner/repo#1";
    const session = { sessionId: "s1", context: baseContext, createdAt: Date.now(), provider: "claude" };

    store.saveSession(key, session);

    const mode = statSync(store.getSessionFilePath(key)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("loads sessions within TTL", () => {
    const dir = makeTempDir();
    const key = "owner/repo#1";
    const session = { sessionId: "s2", context: baseContext, createdAt: Date.now(), provider: "claude" };

    const store = new SessionStore({ dir, ttlMs: 10_000, logger: silentLogger });
    store.saveSession(key, session);

    const reloaded = new SessionStore({ dir, ttlMs: 10_000, logger: silentLogger });
    reloaded.loadAllPersistedSessions();

    expect(reloaded.getSession(key)?.sessionId).toBe("s2");
  });

  it("drops expired sessions on load and deletes the file", () => {
    const dir = makeTempDir();
    const key = "owner/repo#2";
    const expiredSession = {
      sessionId: "expired",
      context: baseContext,
      createdAt: Date.now() - 2000,
      provider: "claude",
    };

    const store = new SessionStore({ dir, ttlMs: 1000, logger: silentLogger });
    store.saveSession(key, expiredSession);

    const reloaded = new SessionStore({ dir, ttlMs: 1000, logger: silentLogger });
    reloaded.loadAllPersistedSessions();

    expect(reloaded.getSession(key)).toBeUndefined();
    expect(existsSync(reloaded.getSessionFilePath(key))).toBe(false);
  });

  it("cleans up expired sessions in memory and on disk", () => {
    const dir = makeTempDir();
    const key = "owner/repo#3";
    const expiredSession = {
      sessionId: "expired",
      context: baseContext,
      createdAt: Date.now() - 2000,
      provider: "claude",
    };

    const store = new SessionStore({ dir, ttlMs: 1000, logger: silentLogger });
    store.saveSession(key, expiredSession);

    store.cleanupExpiredSessions();

    expect(store.getSession(key)).toBeUndefined();
    expect(existsSync(store.getSessionFilePath(key))).toBe(false);
  });

  it("removes corrupted session files during load", () => {
    const dir = makeTempDir();
    const key = "owner/repo#4";
    const store = new SessionStore({ dir, ttlMs: 1000, logger: silentLogger });
    const filePath = store.getSessionFilePath(key);

    writeFileSync(filePath, "{not valid json");
    expect(() => store.loadAllPersistedSessions()).not.toThrow();
    expect(existsSync(filePath)).toBe(false);
  });

  it("cleans up stale temp files for a session", () => {
    const dir = makeTempDir();
    const store = new SessionStore({ dir, ttlMs: 1000, logger: silentLogger });
    const key = "owner/repo#5";
    const filePath = store.getSessionFilePath(key);
    const tempPath = `${filePath}.stale.tmp`;

    writeFileSync(tempPath, "temp");

    const session = { sessionId: "s5", context: baseContext, createdAt: Date.now(), provider: "claude" };
    store.saveSession(key, session);

    expect(existsSync(tempPath)).toBe(false);
  });
});
