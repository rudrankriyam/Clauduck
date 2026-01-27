# CodeDuck

Inspired by Psyduck, CodeDuck is a GitHub bot that helps you with your repositories using AI. Powered by MiniMax M2.1 via the Claude Agent SDK by default, with optional Codex SDK support.

## Features

- **GitHub App Integration** - Receives webhooks for issues, PRs, and comments
- **Command Parsing** - Understands `@codeduck` commands
- **Read Mode** - Summarize, review, explain issues and PRs
- **Implement Mode** - Fix bugs, add features, create branches and PRs
- **Comment Polling** - Detects stop/cancel commands during processing
- **MiniMax M2.1** - Uses Anthropic-compatible API endpoint
- **Multi-provider** - Swap between Claude Agent SDK and Codex SDK

## Commands

### Read-Only Commands
- `@codeduck summarize this` - Summarize an issue or PR
- `@codeduck review this PR` - Review code changes
- `@codeduck explain the bug` - Explain an issue in detail
- `@codeduck help` - Show available commands

Optional provider override:
- `@codeduck review this PR --provider=codex`

### Implementation Commands
- `@codeduck fix the bug` - Implement a fix
- `@codeduck add new feature` - Add new functionality
- `@codeduck implement feature` - Implement a feature request
- `@codeduck refactor code` - Refactor existing code

## Setup

### Prerequisites

- Node.js 20+
- npm or yarn
- MiniMax API key
- GitHub App credentials (or Personal Access Token for testing)

### Installation

```bash
# Clone the repository
git clone https://github.com/rudrankriyam/Clauduck.git
cd Clauduck

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
```

### Environment Variables

```env
# MiniMax API (Anthropic-compatible endpoint)
MINIMAX_API_KEY=your-minimax-api-key

# Provider selection (claude | codex)
AI_PROVIDER=claude

# Codex SDK
CODEX_API_KEY=your-codex-api-key
# Optional: override Codex/OpenAI base URL
OPENAI_BASE_URL=

# GitHub Token (for development/testing)
GITHUB_TOKEN=your-github-token

# GitHub App Configuration (for production)
GITHUB_APP_ID=your-github-app-id
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----..."

# Server Configuration
PORT=3000
NODE_ENV=development
```

### Development

```bash
# Run in development mode
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

### GitHub App Setup (CLI)

Create the GitHub App using the `gh` CLI:

```bash
# Create the GitHub App
gh api apps/create \
  -f name="clauduck" \
  -f url="https://github.com/rudrankriyam/Clauduck" \
  -f webhook_active="true" \
  -f webhook_url="https://your-ngrok.io/webhook" \
  -f webhook_secret="your-webhook-secret" \
  -f default_permissions='contents:write,issues:write,pull_requests:write,comments:write' \
  -f default_events='["issues","issue_comment","pull_request"]'
```

Save the output - you'll need `GITHUB_APP_ID`.

```bash
# Generate and download private key
gh api apps/<APP_ID>/keys -f > github-app-private-key.pem
```

Copy the key content to `GITHUB_APP_PRIVATE_KEY` in `.env` (escape newlines: `cat github-app-private-key.pem | tr '\n' '\\n'`).

### GitHub App Setup (UI)

1. Create a GitHub App at https://github.com/settings/apps/new
2. Set the webhook URL to your server (use ngrok for local development)
3. Subscribe to events:
   - Issues
   - Issue comments
   - Pull requests
4. Install the app on your repositories

## Project Structure

```
clauduck/
├── src/
│   ├── index.ts              # Entry point
│   ├── server.ts             # Express webhook server
│   ├── agent/
│   │   └── client.ts         # Claude Agent SDK integration
│   ├── commands/
│   │   ├── parser.ts         # Command parsing
│   │   ├── router.ts         # Command routing
│   │   └── implementer.ts    # Git workflows for implementation
│   ├── github/
│   │   ├── app.ts            # GitHub App authentication
│   │   └── client.ts         # Octokit client
│   ├── polling/
│   │   └── comment-poller.ts # Comment polling for stop commands
│   └── utils/
│       └── types.ts          # TypeScript type definitions
├── package.json
├── tsconfig.json
└── README.md
```

## How It Works

1. **Webhook Received** - GitHub sends an event to your server
2. **Command Parsed** - Extract `@clauduck` command from comment
3. **Mode Determined** - Read-only or Implementation mode
4. **Claude Agent Runs** - MiniMax M2.1 processes the request
5. **Response Posted** - Results posted as a comment

## License

MIT
