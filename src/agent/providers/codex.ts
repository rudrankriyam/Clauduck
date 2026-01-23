import { Codex, type CodexOptions, type ThreadOptions } from "@openai/codex-sdk";
import type { ProviderAdapter, ProviderRunOptions } from "./types.js";

function buildCodexOptions(): CodexOptions | undefined {
  const options: CodexOptions = {};
  if (process.env.CODEX_API_KEY) {
    options.apiKey = process.env.CODEX_API_KEY;
  }
  if (process.env.OPENAI_BASE_URL) {
    options.baseUrl = process.env.OPENAI_BASE_URL;
  }
  return Object.keys(options).length > 0 ? options : undefined;
}

function getThreadOptions(mode: ProviderRunOptions["mode"]): ThreadOptions {
  return {
    workingDirectory: process.cwd(),
    sandboxMode: mode === "write" ? "workspace-write" : "read-only",
  };
}

function buildInput(systemPrompt: string, prompt: string): string {
  return `${systemPrompt}\n\n${prompt}`.trim();
}

export const codexProvider: ProviderAdapter = {
  id: "codex",
  displayName: "Codex SDK",
  capabilities: {
    supportsStreaming: true,
    supportsTools: false,
    supportsBash: false,
  },
  async runSession(options: ProviderRunOptions) {
    const { context, prompt, mode, sessionKey, sessionStore, systemPrompt } = options;
    const codex = new Codex(buildCodexOptions());
    const threadOptions = getThreadOptions(mode);
    const input = buildInput(systemPrompt, prompt);
    const sessionInfo = sessionStore.getSession(sessionKey);

    console.log(`[AGENT][CODEX] Session key: ${sessionKey}`);
    console.log(`[AGENT][CODEX] Existing thread: ${sessionInfo ? sessionInfo.sessionId : "none"}`);

    try {
      const thread = sessionInfo
        ? codex.resumeThread(sessionInfo.sessionId, threadOptions)
        : codex.startThread(threadOptions);

      const turn = await thread.run(input);
      const threadId = thread.id;

      if (threadId) {
        sessionStore.saveSession(sessionKey, {
          sessionId: threadId,
          context,
          createdAt: Date.now(),
          provider: "codex",
        });
      }

      return {
        success: true,
        result: turn.finalResponse,
      };
    } catch (error) {
      console.error(`[AGENT][CODEX] ERROR: ${error instanceof Error ? error.message : "Unknown error"}`);
      return {
        success: false,
        result: "",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
  async *runSessionStream(options: ProviderRunOptions) {
    const { context, prompt, mode, sessionKey, sessionStore, systemPrompt } = options;
    const codex = new Codex(buildCodexOptions());
    const threadOptions = getThreadOptions(mode);
    const input = buildInput(systemPrompt, prompt);
    const sessionInfo = sessionStore.getSession(sessionKey);

    const thread = sessionInfo
      ? codex.resumeThread(sessionInfo.sessionId, threadOptions)
      : codex.startThread(threadOptions);

    const { events } = await thread.runStreamed(input);

    for await (const event of events) {
      if (event.type === "thread.started") {
        sessionStore.saveSession(sessionKey, {
          sessionId: event.thread_id,
          context,
          createdAt: Date.now(),
          provider: "codex",
        });
      }

      if (event.type === "item.completed" && event.item.type === "agent_message") {
        yield event.item.text;
      }

      if (event.type === "turn.failed") {
        yield `[Error: ${event.error.message}]`;
        return;
      }
    }
  },
};
