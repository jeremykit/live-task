# Live Task - 直播间验证码自动刷新工具

自动刷新直播间验证码并推送到企业微信的 Python 脚本。

## 功能特性

- 支持多个服务器同时刷新验证码
- 每个服务器的刷新结果都会单独推送到企业微信群机器人（成功/失败各一条）
- 支持通过环境变量配置
- 适合在 GitHub Actions 中定时执行

## 快速开始

### 1. 克隆仓库

```bash
git clone <your-repo-url>
cd live-task
```

### 2. 安装依赖

本项目使用 [uv](https://github.com/astral-sh/uv) 作为包管理器。

#### 安装 uv

```bash
# macOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

#### 安装项目依赖

```bash
uv sync
```

### 3. 配置环境变量

创建 `.env` 文件或设置以下环境变量：

```bash
# 东区服务器配置
export EAST_URL="your-east-server.com"
export EAST_TOKEN="your-east-token"
export EAST_ROOM_ID="your-east-room-id"

# 西区服务器配置
export WEST_URL="your-west-server.com"
export WEST_TOKEN="your-west-token"
export WEST_ROOM_ID="your-west-room-id"

# 河北服务器配置
export HEBEI_URL="your-hebei-server.com"
export HEBEI_TOKEN="your-hebei-token"
export HEBEI_ROOM_ID="your-hebei-room-id"

# 企业微信 Webhook Key
export WECHAT_WEBHOOK_KEY="your-wechat-webhook-key"
```

### 4. 运行脚本

```bash
# 使用 uv 运行
uv run python refresh_code.py
```

## GitHub Actions 配置

### 配置 Secrets

在 GitHub 仓库中配置以下 Secrets（Settings → Secrets and variables → Actions → New repository secret）：

| Secret 名称 | 说明 | 示例 |
|------------|------|------|
| `EAST_URL` | 东区服务器地址 | `api.example.com` |
| `EAST_TOKEN` | 东区服务器 Token | `eyJhbGciOiJIUzI1NiIsInR5cCI6...` |
| `EAST_ROOM_ID` | 东区直播间 ID | `12345` |
| `WEST_URL` | 西区服务器地址 | `api.example.com` |
| `WEST_TOKEN` | 西区服务器 Token | `eyJhbGciOiJIUzI1NiIsInR5cCI6...` |
| `WEST_ROOM_ID` | 西区直播间 ID | `12346` |
| `HEBEI_URL` | 河北服务器地址 | `api.example.com` |
| `HEBEI_TOKEN` | 河北服务器 Token | `eyJhbGciOiJIUzI1NiIsInR5cCI6...` |
| `HEBEI_ROOM_ID` | 河北直播间 ID | `12347` |
| `WECHAT_WEBHOOK_KEY` | 企业微信机器人 Key | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |

### 创建 Workflow 文件

创建 `.github/workflows/refresh-code.yml`：

```yaml
name: Refresh Live Room Code

on:
  schedule:
    # 每天 8:00 和 20:00 执行（UTC 时间，需要换算为北京时间）
    - cron: '0 0,12 * * *'
  workflow_dispatch: # 支持手动触发

jobs:
  refresh:
    runs-on: ubuntu-latest

    steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Install uv
      uses: astral-sh/setup-uv@v2
      with:
        version: "latest"

    - name: Set up Python
      run: uv python install 3.12

    - name: Install dependencies
      run: uv sync

    - name: Run refresh script
      env:
        EAST_URL: ${{ secrets.EAST_URL }}
        EAST_TOKEN: ${{ secrets.EAST_TOKEN }}
        EAST_ROOM_ID: ${{ secrets.EAST_ROOM_ID }}
        WEST_URL: ${{ secrets.WEST_URL }}
        WEST_TOKEN: ${{ secrets.WEST_TOKEN }}
        WEST_ROOM_ID: ${{ secrets.WEST_ROOM_ID }}
        HEBEI_URL: ${{ secrets.HEBEI_URL }}
        HEBEI_TOKEN: ${{ secrets.HEBEI_TOKEN }}
        HEBEI_ROOM_ID: ${{ secrets.HEBEI_ROOM_ID }}
        WECHAT_WEBHOOK_KEY: ${{ secrets.WECHAT_WEBHOOK_KEY }}
      run: uv run python refresh_code.py
```

## 在 Cloudflare Workers 上运行

`worker/cf_worker.js` 提供了与 `refresh_code.py` 相同的逻辑，既可以作为 Worker 部署，也可以在本地或 GitHub Actions 中直接运行，方便对比两种运行环境的效果。该目录同时包含 `wrangler.toml`，可直接用于发布。

### 1) 部署到 Cloudflare Workers

1. 使用仓库自带的 `worker/wrangler.toml`，默认的 Worker 项目名为 `live-task-refresh`，可按需修改 `name`、`crons`、`compatibility_date` 等配置：

```toml
name = "live-task-refresh"
main = "cf_worker.js"
compatibility_date = "2024-01-01"
# 默认开启每周五中午 12:00（UTC+8，对应 UTC 04:00）定时任务；如需调整请修改 crons。

[triggers]
crons = ["0 4 * * 5"]

[vars]
# 可选：非敏感信息可写在 vars；敏感 Token/Key 建议通过 CI 或 wrangler 命令行传入
```

2. 部署：

```bash
cd worker
wrangler deploy \
  --var EAST_URL="$EAST_URL" \
  --var EAST_TOKEN="$EAST_TOKEN" \
  --var EAST_ROOM_ID="$EAST_ROOM_ID" \
  --var WEST_URL="$WEST_URL" \
  --var WEST_TOKEN="$WEST_TOKEN" \
  --var WEST_ROOM_ID="$WEST_ROOM_ID" \
  --var HEBEI_URL="$HEBEI_URL" \
  --var HEBEI_TOKEN="$HEBEI_TOKEN" \
  --var HEBEI_ROOM_ID="$HEBEI_ROOM_ID" \
  --var WECHAT_WEBHOOK_KEY="$WECHAT_WEBHOOK_KEY"
```

3. 手动触发或接入路由：部署后访问 `https://<worker>.<your-subdomain>.workers.dev/refresh` 即可手动执行。若配置了 `crons`，Worker 会按计划自动执行。

#### 如何提前验证定时任务

- **本地/远程模拟定时触发**：在 `worker` 目录下运行 `wrangler dev --remote --test-scheduled`，Wrangler 会模拟一次 `scheduled` 事件执行，无需等待实际 Cron 时间。
- **临时修改 Cron**：将 `wrangler.toml` 中的 `crons` 调整为几分钟后的时间部署一次，用 `wrangler tail` 观察日志；验证后再改回正式的周五 12:00 配置。

### 2) 在 GitHub Actions / 本地运行同一份 Worker 代码

`worker/cf_worker.js` 也支持 Node.js 执行，便于在 GitHub Actions 中与 Python 版本对比：

```yaml
name: Run CF Worker Script
on:
  workflow_dispatch:

jobs:
  run-worker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run worker logic
        env:
          EAST_URL: ${{ secrets.EAST_URL }}
          EAST_TOKEN: ${{ secrets.EAST_TOKEN }}
          EAST_ROOM_ID: ${{ secrets.EAST_ROOM_ID }}
          WEST_URL: ${{ secrets.WEST_URL }}
          WEST_TOKEN: ${{ secrets.WEST_TOKEN }}
          WEST_ROOM_ID: ${{ secrets.WEST_ROOM_ID }}
          HEBEI_URL: ${{ secrets.HEBEI_URL }}
          HEBEI_TOKEN: ${{ secrets.HEBEI_TOKEN }}
          HEBEI_ROOM_ID: ${{ secrets.HEBEI_ROOM_ID }}
          WECHAT_WEBHOOK_KEY: ${{ secrets.WECHAT_WEBHOOK_KEY }}
        run: |
          node worker/cf_worker.js
```

> 说明：`cf_worker.js` 使用 `fetch`，可在 Cloudflare Workers、Node.js 18+（GitHub Actions 默认环境）以及本地带有全局 fetch 的环境下运行。

### 3) 通过 GitHub Actions 手动部署 Cloudflare Worker

仓库已提供 `.github/workflows/deploy-worker.yml`，支持手动触发发布至 Cloudflare Workers。

1. 在仓库 Secrets 中新增以下凭据（Settings → Secrets and variables → Actions）：
   - `CLOUDFLARE_API_TOKEN`：具备 `Workers Scripts`、`Workers KV Storage`（如需）等权限
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID
   - `EAST_URL`、`EAST_TOKEN`、`EAST_ROOM_ID`、`WEST_URL`、`WEST_TOKEN`、`WEST_ROOM_ID`、`HEBEI_URL`、`HEBEI_TOKEN`、`HEBEI_ROOM_ID`、`WECHAT_WEBHOOK_KEY`
2. 进入 GitHub Actions → `Deploy Cloudflare Worker` → `Run workflow` 手动触发。
3. 工作流会读取 `worker/wrangler.toml` 并注入上述 Secrets 完成部署。

## 企业微信机器人配置

1. 在企业微信群中添加机器人
2. 获取 Webhook 地址：`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY`
3. 将 `YOUR_KEY` 部分配置到 `WECHAT_WEBHOOK_KEY` 环境变量

## 项目结构

```
live-task/
├── refresh_code.py      # 主程序脚本
├── pyproject.toml       # 项目配置和依赖管理
├── README.md            # 项目说明文档
├── worker/              # Cloudflare Worker 版本代码与 wrangler 配置
└── .github/
    └── workflows/
        ├── deploy-worker.yml # 手动部署 Cloudflare Worker 的工作流
        └── refresh-code.yml  # 刷新验证码工作流
```

## 依赖说明

- Python >= 3.10
- requests >= 2.31.0

## 常用命令

```bash
# 安装依赖
uv sync

# 添加新依赖
uv add <package-name>

# 运行脚本
uv run python refresh_code.py
```

## 许可证

MIT
