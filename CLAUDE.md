# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

直播间验证码自动刷新工具 - 自动获取直播间列表，按名称过滤后刷新验证码，并推送到企业微信。

## Common Commands

```bash
# Install dependencies (uses uv package manager)
uv sync

# Run Python script locally
uv run python refresh_code.py

# Run Cloudflare Worker locally (Node.js 18+)
node worker/cf_worker.js

# Deploy Worker to Cloudflare
cd worker && wrangler deploy

# Test scheduled trigger locally
cd worker && wrangler dev --remote --test-scheduled
```

## Architecture

Two parallel implementations with identical logic:

1. **Python version** (`refresh_code.py`) - For GitHub Actions manual trigger
2. **Cloudflare Worker** (`worker/cf_worker.js`) - For scheduled cron execution and HTTP trigger

Both implementations:
- Read config from environment variables (SERVER_ALIAS_LIST, SERVER_URL_LIST, LIVE_NAME_LIST, SERVER_TOKEN, WECHAT_WEBHOOK_KEY)
- Fetch live room list from each server via POST to `/api/live/liveList`
- Filter rooms by name matching against LIVE_NAME_LIST
- Refresh verification codes via POST to `/api/live/refreshVerifyCode`
- Send results to WeChat Work webhook (one message per server)

## Environment Variables

| Variable | Description |
|----------|-------------|
| SERVER_ALIAS_LIST | Comma-separated server aliases (e.g., "E,W,H") |
| SERVER_URL_LIST | Comma-separated server URLs (same order as aliases) |
| LIVE_NAME_LIST | Comma-separated room name patterns to match |
| SERVER_TOKEN | Auth token for API requests |
| WECHAT_WEBHOOK_KEY | WeChat Work robot webhook key |

## Deployment

- **Cloudflare Worker**: Deploy via `.github/workflows/deploy-worker.yml` (manual trigger)
- **Python script**: Run via `.github/workflows/refresh-code.yml` (manual trigger)
- Scheduled execution is handled by Cloudflare Worker cron (configured in `worker/wrangler.toml`)
