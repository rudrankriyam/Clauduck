import {
  unstable_v2_createSession,
  unstable_v2_resumeSession,
} from "@anthropic-ai/claude-agent-sdk";
import type { ProviderAdapter, ProviderRunOptions } from "./types.js";

export function getClaudeSessionOptions(systemPrompt: string, hasBash: boolean) {
  const allowedTools = hasBash ? ["Read", "Bash", "Glob", "Grep"] : ["Read", "Glob", "Grep"];

  return {
    model: "MiniMax-M2.1",
    allowedTools,
    env: {
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || "https://api.minimax.io/anthropic",
      ANTHROPIC_API_KEY: process.env.MINIMAX_API_KEY || "",
      PATH: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
      GH_TOKEN: process.env.GH_TOKEN || "",
    },
    systemPrompt,
    maxTurns: 50,
  };
}

export const claudeProvider: ProviderAdapter = {
  id: "claude",
  displayName: "Claude Agent SDK",
  capabilities: {
    supportsStreaming: true,
    supportsTools: true,
    supportsBash: true,
  },
  async runSession(options: ProviderRunOptions) {
    const { context, prompt, mode, sessionKey, sessionStore, systemPrompt } = options;
    const hasBash = mode === "write";
    const sessionOptions = getClaudeSessionOptions(systemPrompt, hasBash);
    const sessionInfo = sessionStore.getSession(sessionKey);

    console.log(`[AGENT][CLAUDE] Session key: ${sessionKey}`);
    console.log(`[AGENT][CLAUDE] Existing session: ${sessionInfo ? sessionInfo.sessionId : "none"}`);

    try {
      const session = sessionInfo
        ? unstable_v2_resumeSession(sessionInfo.sessionId, sessionOptions)
        : unstable_v2_createSession(sessionOptions);

      console.log(`[AGENT][CLAUDE] Sending prompt to MiniMax...`);
      await session.send(prompt);

      let result = "";
      let sessionId: string | undefined;
      let messageCount = 0;

      for await (const message of session.stream()) {
        messageCount++;
        const subtype = "subtype" in message ? (message as { subtype: string }).subtype : "none";
        console.log(`[AGENT][CLAUDE] Message ${messageCount}: type=${message.type}, subtype=${subtype}`);

        if (message.type === "system") {
          const sysMsg = message as { subtype: string; session_id: string };
          if (sysMsg.subtype === "init") {
            sessionId = sysMsg.session_id;
            console.log(`[AGENT][CLAUDE] Session ID: ${sessionId}`);
            sessionStore.saveSession(sessionKey, {
              sessionId,
              context,
              createdAt: Date.now(),
              provider: "claude",
            });
            console.log(`[AGENT][CLAUDE] Session saved`);
          }
        }

        if (message.type === "assistant") {
          const content = message.message.content;
          if (typeof content === "string") {
            result = content;
          } else if (Array.isArray(content)) {
            const textBlock = content.find((block): block is { type: "text"; text: string } =>
              block.type === "text"
            );
            if (textBlock) {
              result = textBlock.text;
            }
          }
          console.log(`[AGENT][CLAUDE] Got assistant message, result length: ${result.length}`);
        }

        if (message.type === "result") {
          console.log(`[AGENT][CLAUDE] Got result message, subtype: ${message.subtype}`);
          if (message.subtype === "success") {
            result = message.result;
            console.log(`[AGENT][CLAUDE] SUCCESS! Result: "${result.slice(0, 200)}..."`);
            return { success: true, result };
          }
          console.log(`[AGENT][CLAUDE] ERROR: ${message.subtype}`);
          return { success: false, result: "", error: message.subtype || "Session error" };
        }
      }

      console.log(`[AGENT][CLAUDE] Stream complete, result: "${result.slice(0, 200)}..."`);
      return { success: true, result };
    } catch (error) {
      console.error(`[AGENT][CLAUDE] ERROR: ${error instanceof Error ? error.message : "Unknown error"}`);
      return {
        success: false,
        result: "",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
  async *runSessionStream(options: ProviderRunOptions) {
    const { context, prompt, mode, sessionKey, sessionStore, systemPrompt } = options;
    const hasBash = mode === "write";
    const sessionOptions = getClaudeSessionOptions(systemPrompt, hasBash);
    const sessionInfo = sessionStore.getSession(sessionKey);

    const session = sessionInfo
      ? unstable_v2_resumeSession(sessionInfo.sessionId, sessionOptions)
      : unstable_v2_createSession(sessionOptions);

    await session.send(prompt);

    for await (const message of session.stream()) {
      if (message.type === "system" && message.subtype === "init") {
        const sessionId = message.session_id;
        sessionStore.saveSession(sessionKey, {
          sessionId,
          context,
          createdAt: Date.now(),
          provider: "claude",
        });
      }

      if (message.type === "assistant") {
        const content = message.message.content;
        if (typeof content === "string") {
          yield content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              yield block.text;
            }
          }
        }
      }

      if (message.type === "result") {
        if (message.subtype === "success") {
          yield message.result;
        } else {
          yield `[Error: ${message.subtype || "Session error"}]`;
          return;
        }
      }
    }
  },
};
