# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Run with ts-node (auto-reloads)
npm run build        # Compile TypeScript to dist/
npm run start        # Run production build
npm run typecheck    # Type-check without emitting
npm run lint         # Run ESLint

# Code audit
npx @anthropic-ai/codex-cli review  # Run Codex security/code review
```

## Architecture

CodeDuck is a GitHub bot that responds to `@codeduck` mentions using MiniMax M2.1 via the Claude Agent SDK V2 session API.

### V2 Session API Usage

```typescript
// Create new session or resume existing
const session = sessionInfo
  ? unstable_v2_resumeSession(sessionInfo.sessionId, options)
  : unstable_v2_createSession(options);

await session.send(prompt);

for await (const message of session.stream()) {
  if (message.type === "system" && message.subtype === "init") {
    sessionId = message.session_id; // Capture for resume
  }
  // Handle assistant, result messages...
}
```

Sessions are persisted to disk in `/tmp/codeduck-sessions` (configurable via `SESSION_DIR` env var) per `${owner}/${repo}#${issueNumber}`. Loaded on startup with 24-hour TTL. Use `clearSession(context)` to reset.

### Security

- Webhook signature verification is mandatory in production (`GITHUB_WEBHOOK_SECRET`)
- Shell commands use execFileSync with validated inputs (no string interpolation)
- Read mode restricts tools to `["Read", "Grep", "Glob"]` (no Bash)
- Token validation throws early if `GITHUB_TOKEN` is missing
- Session storage persisted to disk with 24-hour TTL (survives restarts)

### Configuration

Required environment variables:
- `MINIMAX_API_KEY` - MiniMax API key (Anthropic-compatible endpoint)
- `GITHUB_APP_ID` - GitHub App ID (required for GitHub App mode)
- `GITHUB_APP_PRIVATE_KEY` - GitHub App private key (PEM format, newlines escaped)
- `GITHUB_APP_WEBHOOK_SECRET` - GitHub App webhook secret
- `PORT` - Server port (default: 3000)
- `SESSION_DIR` - Session storage directory (default: `/tmp/codeduck-sessions`)
- `NODE_ENV` - Set to "development" to skip webhook verification (not recommended for production)

**Required:** GitHub App configuration (PAT mode not supported):
- `GITHUB_APP_ID` - GitHub App ID
- `GITHUB_APP_PRIVATE_KEY` - GitHub App private key (PEM format, newlines escaped)
- `GITHUB_APP_WEBHOOK_SECRET` - GitHub App webhook secret

GitHub App mode provides per-repository installation tokens (principle of least privilege) instead of broad PAT access.

MiniMax endpoint: `https://api.minimax.io/anthropic`
Model: `MiniMax-M2.1`

### GitHub App Setup

1. Create a GitHub App at https://github.com/settings/apps
2. Set webhook URL to your server's `/webhook` endpoint
3. Subscribe to events: `issues`, `pull_request`, `issue_comment`
4. Generate a private key and set `GITHUB_APP_PRIVATE_KEY` (escape newlines as `\\n`)
5. Install the app on target repositories

Benefits of GitHub App:
- Per-repository installation tokens (principle of least privilege)
- Webhook signature verification with dedicated secret
- More granular permissions than PAT

### Git Conventions

Commits follow Conventional Commits: `feat:`, `fix:`, `refactor:` prefixes. PRs created with `feat: Implement issue #${number}` titles.

### Available Commands

- `@codeduck summarize [target]` - Summarize code or repository
- `@codeduck review [target]` - Review code for issues
- `@codeduck explain [target]` - Explain code or concepts
- `@codeduck implement [description]` - Implement a feature or fix
- `@codeduck fix [description]` - Fix a bug
- `@codeduck help` - Show help message

### Session Management

- Sessions persist per issue/PR for multi-turn context
- Use `stop`, `cancel`, `abort` to clear session
- Sessions persisted to disk with 24-hour TTL, survive bot restarts
- Storage directory: `/tmp/codeduck-sessions` (configurable via `SESSION_DIR`)
