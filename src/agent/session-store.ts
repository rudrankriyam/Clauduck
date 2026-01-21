/**
 * Session store with disk persistence and TTL cleanup.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import type { GitHubContext } from "../utils/types.js";

export interface SessionInfo {
  sessionId: string;
  context: GitHubContext;
  createdAt: number;
}

interface SessionStoreOptions {
  dir: string;
  ttlMs: number;
  logger?: Pick<Console, "log" | "warn" | "error">;
}

export class SessionStore {
  private readonly dir: string;
  private readonly ttlMs: number;
  private readonly logger: Pick<Console, "log" | "warn" | "error">;
  private sessions = new Map<string, SessionInfo>();

  constructor(options: SessionStoreOptions) {
    this.dir = options.dir;
    this.ttlMs = options.ttlMs;
    this.logger = options.logger ?? console;
  }

  initStorage(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
      chmodSync(this.dir, 0o700);
    }
  }

  getSessionFilePath(key: string): string {
    return join(this.dir, `${Buffer.from(key).toString("base64")}.json`);
  }

  saveSession(key: string, session: SessionInfo): void {
    this.sessions.set(key, session);
    this.persistSession(key, session);
  }

  getSession(key: string): SessionInfo | undefined {
    return this.sessions.get(key);
  }

  deleteSession(key: string): void {
    this.sessions.delete(key);
    this.deletePersistedFile(key);
  }

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  persistSession(key: string, session: SessionInfo): void {
    try {
      this.initStorage();
      const filePath = this.getSessionFilePath(key);
      const tempPath = `${filePath}.${Date.now()}.tmp`;
      writeFileSync(tempPath, JSON.stringify(session, null, 2), { mode: 0o600 });

      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }

      try {
        renameSync(tempPath, filePath);
      } catch {
        writeFileSync(filePath, readFileSync(tempPath), { mode: 0o600 });
        unlinkSync(tempPath);
      }

      this.cleanupTempFilesForKey(key);
    } catch (error) {
      this.logger.error(`Failed to persist session ${key}:`, error);
    }
  }

  loadAllPersistedSessions(): void {
    this.initStorage();
    try {
      const files = readdirSync(this.dir);
      let loaded = 0;
      for (const file of files) {
        if (file.endsWith(".json") && !file.endsWith(".tmp")) {
          const filePath = join(this.dir, file);
          try {
            const data = JSON.parse(readFileSync(filePath, "utf-8")) as SessionInfo;
            if (Date.now() - data.createdAt <= this.ttlMs) {
              const key = Buffer.from(file.replace(".json", ""), "base64").toString();
              this.sessions.set(key, data);
              loaded++;
            } else {
              unlinkSync(filePath);
            }
          } catch {
            // Remove corrupted files
            try {
              unlinkSync(filePath);
            } catch {
              // ignore
            }
          }
        }
      }
      if (loaded > 0) {
        this.logger.log(`Loaded ${loaded} persisted sessions`);
      }
    } catch (error) {
      this.logger.error("Failed to load persisted sessions:", error);
    }
  }

  cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (now - session.createdAt > this.ttlMs) {
        this.sessions.delete(key);
        this.deletePersistedFile(key);
        this.logger.log(`Cleaned up expired session: ${key}`);
      }
    }
  }

  private deletePersistedFile(key: string): void {
    try {
      const filePath = this.getSessionFilePath(key);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  private cleanupTempFilesForKey(key: string): void {
    try {
      const baseName = `${Buffer.from(key).toString("base64")}.json`;
      const files = readdirSync(this.dir);
      for (const file of files) {
        if (file.startsWith(`${baseName}.`) && file.endsWith(".tmp")) {
          try {
            unlinkSync(join(this.dir, file));
          } catch {
            // best-effort cleanup
          }
        }
      }
    } catch {
      // best-effort cleanup
    }
  }
}
