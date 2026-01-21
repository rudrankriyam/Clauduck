/**
 * Clauduck - GitHub Bot with Claude Agent SDK
 *
 * Entry point for the application
 */

import { app } from "./server.js";

const PORT = process.env.PORT || 3000;

// Start the server
app.listen(PORT, () => {
  console.log(`=== Clauduck ===`);
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
  console.log();
  console.log("Ready to receive GitHub events!");
});
