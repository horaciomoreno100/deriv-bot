# Claude Code Rules for deriv-bot

## Deployment Rules

**NEVER deploy manually.** Always use the release system:

```bash
# Preview release (dry run)
pnpm release:dry

# Patch release (0.3.0 → 0.3.1)
pnpm release

# Minor release (0.3.0 → 0.4.0)
pnpm release:minor

# Major release (0.3.0 → 1.0.0)
pnpm release:major
```

This automatically:
1. Bumps version in package.json
2. Updates CHANGELOG.md with conventional commits
3. Creates git commit and tag
4. Pushes to GitHub
5. Creates GitHub Release

**After release:** The server will pull and deploy via webhook or manual trigger.

## Why No Manual Deploys?

- Manual deploys skip version tracking
- CHANGELOG doesn't get updated
- No GitHub release created
- Hard to rollback or track what's in production

## Commit Convention

Use conventional commits for proper changelog generation:

- `feat:` - New feature (bumps minor)
- `fix:` - Bug fix (bumps patch)
- `refactor:` - Code refactoring
- `docs:` - Documentation
- `chore:` - Maintenance tasks
- `perf:` - Performance improvements

Example: `feat: add Slack alerts for crash detection`

## Server Management

After release is pushed:

```bash
# SSH to server
ssh root@37.27.47.129

# Manual pull and rebuild (if webhook not configured)
cd /opt/apps/deriv-bot
git pull origin main
pnpm build
pm2 restart all --update-env
```

## Current Architecture

```
packages/
├── gateway/    - WebSocket server, Deriv API connection
├── trader/     - Trading strategies (BB-Squeeze, Mean Reversion)
├── telegram/   - Telegram bot for monitoring
├── shared/     - Types, utilities, SlackAlerter
├── web-ui/     - Dashboard (not in production)
└── cli/        - REPL (not in production)
```

## Environment Variables

Production server needs:
- `DERIV_APP_ID`
- `DERIV_API_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `SLACK_WEBHOOK_URL`

## Testing Before Release

Always run:
```bash
pnpm build        # Check compilation
pnpm test         # Run tests
pnpm release:dry  # Preview release
```
