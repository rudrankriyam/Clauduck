import { describe, it, expect } from "vitest";
import {
  parseCommand,
  hasCodeDuckMention,
  extractCommand,
  getModeDescription,
  isStopCommand,
} from "../src/commands/parser.js";

describe("command parser", () => {
  it("parses summarize command", () => {
    const result = parseCommand("@codeduck summarize this");
    expect(result).not.toBeNull();
    expect(result?.action).toBe("summarize");
    expect(result?.target).toBe("this");
    expect(result?.mode).toBe("read");
  });

  it("parses review command with empty target", () => {
    const result = parseCommand("@codeduck review");
    expect(result).not.toBeNull();
    expect(result?.action).toBe("review");
    expect(result?.target).toBe("");
    expect(result?.mode).toBe("read");
  });

  it("parses write-mode command", () => {
    const result = parseCommand("@codeduck fix the auth bug");
    expect(result).not.toBeNull();
    expect(result?.action).toBe("fix");
    expect(result?.target).toBe("the auth bug");
    expect(result?.mode).toBe("write");
  });

  it("handles [bot] mention", () => {
    const result = parseCommand("@codeduck[bot] explain rate limiter");
    expect(result).not.toBeNull();
    expect(result?.action).toBe("explain");
    expect(result?.target).toBe("rate limiter");
    expect(result?.mode).toBe("read");
  });

  it("parses provider flag with equals syntax", () => {
    const result = parseCommand("@codeduck review --provider=codex");
    expect(result).not.toBeNull();
    expect(result?.action).toBe("review");
    expect(result?.target).toBe("");
    expect(result?.provider).toBe("codex");
  });

  it("parses provider flag with space syntax", () => {
    const result = parseCommand("@codeduck fix flaky test --provider claude");
    expect(result).not.toBeNull();
    expect(result?.action).toBe("fix");
    expect(result?.target).toBe("flaky test");
    expect(result?.provider).toBe("claude");
  });

  it("returns null when only mention exists", () => {
    const result = parseCommand("@codeduck");
    expect(result).toBeNull();
  });
});

describe("mention detection", () => {
  it("detects valid mentions", () => {
    expect(hasCodeDuckMention("hello @codeduck")).toBe(true);
    expect(hasCodeDuckMention("hello @codeduck[bot]")).toBe(true);
  });

  it("does not match partial words", () => {
    expect(hasCodeDuckMention("hello @codeduckish")).toBe(false);
  });
});

describe("command extraction", () => {
  it("extracts command text after mention", () => {
    expect(extractCommand("@codeduck review this")).toBe("review this");
  });
});

describe("stop detection", () => {
  it("detects stop/cancel keywords", () => {
    expect(isStopCommand("review this stop")).toBe(true);
    expect(isStopCommand("please cancel")).toBe(true);
  });

  it("does not match unrelated words", () => {
    expect(isStopCommand("summarize this")).toBe(false);
  });
});

describe("mode description", () => {
  it("returns human readable descriptions", () => {
    expect(getModeDescription("read")).toBe("Read-only analysis");
    expect(getModeDescription("write")).toBe("Implementation mode");
  });
});
