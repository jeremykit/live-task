# Live Task - 直播间验证码自动刷新工具

自动刷新直播间验证码并推送到企业微信的 Python 脚本。

## 功能特性

- 支持多个服务器同时刷新验证码
- 自动推送结果到企业微信群机器人
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

# 或使用快捷命令
uv run live-refresh
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
└── .github/
    └── workflows/
        └── refresh-code.yml  # GitHub Actions 工作流
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

# 使用快捷命令
uv run live-refresh
```

## 许可证

MIT
