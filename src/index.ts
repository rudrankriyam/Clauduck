/**
 * Clauduck - GitHub Bot with Claude Agent SDK
 *
 * Entry point for the application
 */

import { simpleQuery, getMiniMaxOptions } from "./agent/client";

async function main() {
  console.log("=== Clauduck ===");
  console.log("GitHub Bot with Claude Agent SDK\n");

  // Demo the basic structure
  const result = await simpleQuery("Test prompt");
  console.log(result);

  console.log("\n=== MiniMax Configuration ===");
  const options = getMiniMaxOptions();
  console.log("ANTHROPIC_BASE_URL:", options.env?.ANTHROPIC_BASE_URL);
  console.log("Allowed tools:", options.allowedTools);
  console.log("Permission mode:", options.permissionMode);
}

main().catch(console.error);
