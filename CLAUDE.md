# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev          # Run with ts-node (auto-reloads)
npm run build        # Compile TypeScript to dist/
npm run start        # Run production build
npm run typecheck    # Type-check without emitting

# Code audit
npx @anthropic-ai/codex-cli review  # Run Codex security/code review
```

## Architecture

Clauduck is a GitHub bot that responds to `@clauduck` mentions using MiniMax M2.1 via the Claude Agent SDK V2 session API.

### Data Flow

```
GitHub Webhook → Express Server → Command Parser → Claude Agent SDK V2 → GitHub API
                      ↓                                        ↓
              Event Handlers                      MiniMax M2.1 (session-based)
              (issue_comment, issues, PR)                  ↓
                                                    Session Persistence
                                                    (per issue/PR)
```

### Key Components

- **src/server.ts**: Express webhook server. Validates HMAC-SHA256 signatures before processing. Routes events to handlers. Posts results back to GitHub comments.
- **src/agent/client.ts**: Claude Agent SDK V2 wrapper. Uses `unstable_v2_createSession` and `unstable_v2_resumeSession` for multi-turn context. Session key is `${owner}/${repo}#${issueNumber}`. Configures MiniMax via `ANTHROPIC_BASE_URL` and `ANTHROPIC_API_KEY` env vars. Mode-based tool restrictions (read mode excludes Bash).
- **src/commands/parser.ts**: Parses `@clauduck [action] [target]` into command objects. Determines read vs write mode.
- **src/commands/router.ts**: Routes commands to appropriate handlers. Uses executeQuery with proper AgentResponse handling.
- **src/commands/implementer.ts**: Git workflow automation. Clones repos to `/tmp/clauduck-repos`, creates branches, commits changes, opens PRs. Uses execFileSync (not shell strings) for security.
- **src/github/client.ts**: Octokit wrapper. Validates GITHUB_TOKEN. Fetches default branch from GitHub API.
- **src/polling/comment-poller.ts**: Polls for stop/cancel commands during long-running operations.

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

Sessions are stored in-memory per `${owner}/${repo}#${issueNumber}`. Use `clearSession(context)` to reset.

### Security

- Webhook signature verification is mandatory in production (`GITHUB_WEBHOOK_SECRET`)
- Shell commands use execFileSync with validated inputs (no string interpolation)
- Read mode restricts tools to `["Read", "Grep", "Glob"]` (no Bash)
- Token validation throws early if `GITHUB_TOKEN` is missing
- Session storage is in-memory (not persisted across restarts)

### Configuration

Required environment variables:
- `MINIMAX_API_KEY` - MiniMax API key (Anthropic-compatible endpoint)
- `GITHUB_TOKEN` - GitHub PAT or App installation token
- `GITHUB_WEBHOOK_SECRET` - Webhook signature secret (production)
- `PORT` - Server port (default: 3000)

MiniMax endpoint: `https://api.minimax.io/anthropic`
Model: `MiniMax-M2.1`

### Git Conventions

Commits follow Conventional Commits: `feat:`, `fix:`, `refactor:` prefixes. PRs created with `feat: Implement issue #${number}` titles.

### Available Commands

- `@clauduck summarize [target]` - Summarize code or repository
- `@clauduck review [target]` - Review code for issues
- `@clauduck explain [target]` - Explain code or concepts
- `@clauduck implement [description]` - Implement a feature or fix
- `@clauduck fix [description]` - Fix a bug
- `@clauduck help` - Show help message

### Session Management

- Sessions persist per issue/PR for multi-turn context
- Use `stop`, `cancel`, `abort` to clear session
- Sessions stored in-memory, cleared on bot restart
