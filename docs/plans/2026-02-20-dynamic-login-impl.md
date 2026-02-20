# 动态登录获取 Token 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将静态 token 认证改为每次执行时动态登录获取 token

**Architecture:** 在刷码流程开始前，先调用登录接口获取 token，登录失败则推送通知并终止

**Tech Stack:** Python 3.12, Cloudflare Workers (JavaScript), GitHub Actions

---

## Task 1: 修改 Python 版本 - 添加登录功能

**Files:**
- Modify: `refresh_code.py:36-46` (LiveCodeRefresher.__init__)
- Modify: `refresh_code.py:215-234` (load_config_from_env)
- Modify: `refresh_code.py:237-244` (main)

**Step 1: 添加 login 方法到 LiveCodeRefresher 类**

在 `refresh_code.py` 的 `_headers` 方法后添加：

```python
def login(self, login_url: str, user_id: str, password: str) -> str:
    """调用登录接口获取 token"""
    endpoint = f"https://{login_url}/api/auth/loginAdmin"
    payload = {"param": {"password": password, "userId": user_id}}
    response = self.session.post(endpoint, json=payload, headers={"Content-Type": "application/json"}, timeout=15)
    response.raise_for_status()
    data = response.json()

    if not data.get("meta", {}).get("success"):
        raise ValueError(data.get("meta", {}).get("message", "登录失败"))

    token = data.get("data", {}).get("token")
    if not token:
        raise ValueError("登录响应中未找到 token")
    return token
```

**Step 2: 修改 load_config_from_env 函数**

将原来读取 `SERVER_TOKEN` 改为读取登录相关变量：

```python
def load_config_from_env() -> tuple[List[ServerConfig], str, str, str, List[str], str]:
    """从环境变量读取配置"""

    aliases = _parse_list("SERVER_ALIAS_LIST")
    urls = _parse_list("SERVER_URL_LIST")
    if len(aliases) != len(urls):
        raise ValueError("SERVER_ALIAS_LIST 与 SERVER_URL_LIST 数量不一致")

    servers = [ServerConfig(alias=alias, url=url) for alias, url in zip(aliases, urls)]

    live_names = _parse_list("LIVE_NAME_LIST")

    login_url = os.getenv("LOGIN_SERVER_URL", "").strip()
    if not login_url:
        raise ValueError("LOGIN_SERVER_URL 未配置")

    login_user_id = os.getenv("LOGIN_USER_ID", "").strip()
    if not login_user_id:
        raise ValueError("LOGIN_USER_ID 未配置")

    login_password = os.getenv("LOGIN_PASSWORD", "").strip()
    if not login_password:
        raise ValueError("LOGIN_PASSWORD 未配置")

    webhook_key = os.getenv("WECHAT_WEBHOOK_KEY", "").strip()
    if not webhook_key:
        raise ValueError("WECHAT_WEBHOOK_KEY 未配置")

    return servers, login_url, login_user_id, login_password, live_names, webhook_key
```

**Step 3: 修改 LiveCodeRefresher.__init__ 方法**

移除 token 参数，改为后续通过 login 设置：

```python
def __init__(self, servers: List[ServerConfig], live_names: List[str], webhook_key: str):
    self.servers = servers
    self.token = ""  # 通过 login 方法设置
    self.live_names = live_names
    self.webhook_url = f"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key={webhook_key}"
    self.session = requests.Session()
```

**Step 4: 修改 main 函数**

```python
def main() -> None:
    try:
        servers, login_url, login_user_id, login_password, live_names, webhook_key = load_config_from_env()
        refresher = LiveCodeRefresher(servers, live_names, webhook_key)

        # 登录获取 token
        print("正在登录获取 token...")
        try:
            refresher.token = refresher.login(login_url, login_user_id, login_password)
            print("登录成功")
        except Exception as exc:
            error_msg = f"刷码失败：账号 {login_user_id} 登录失败 - {exc}"
            print(error_msg)
            # 推送登录失败通知
            payload = {"msgtype": "text", "text": {"content": error_msg}}
            refresher.session.post(refresher.webhook_url, json=payload, timeout=10)
            raise

        refresher.run()
    except Exception as exc:
        print(f"程序执行失败: {exc}")
        raise
```

**Step 5: 验证修改**

Run: `uv run python -c "from refresh_code import *; print('Import OK')"`
Expected: `Import OK`

**Step 6: Commit**

```bash
git add refresh_code.py
git commit -m "feat(python): 添加动态登录获取 token 功能"
```

---

## Task 2: 修改 Cloudflare Worker - 添加登录功能

**Files:**
- Modify: `worker/cf_worker.js:29-45` (loadConfig)
- Modify: `worker/cf_worker.js:260-273` (run)

**Step 1: 添加 login 函数**

在 `buildHeaders` 函数后添加：

```javascript
async function login(loginUrl, userId, password, fetcher) {
  const endpoint = `https://${loginUrl}/api/auth/loginAdmin`;
  const payload = { param: { password, userId } };

  const res = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(await safeError(res));

  const data = await safeJson(res);
  if (!data?.meta?.success) throw new Error(data?.meta?.message || "登录失败");

  const token = data?.data?.token;
  if (!token) throw new Error("登录响应中未找到 token");

  return token;
}
```

**Step 2: 修改 loadConfig 函数**

```javascript
function loadConfig(env, overrides = {}) {
  const aliasList = parseList(getEnv(env, overrides, "SERVER_ALIAS_LIST"));
  const urlList = parseList(getEnv(env, overrides, "SERVER_URL_LIST"));
  const liveNames = parseList(getEnv(env, overrides, "LIVE_NAME_LIST"));
  const webhookKey = (getEnv(env, overrides, "WECHAT_WEBHOOK_KEY") || "").trim();

  const loginUrl = (getEnv(env, overrides, "LOGIN_SERVER_URL") || "").trim();
  const loginUserId = (getEnv(env, overrides, "LOGIN_USER_ID") || "").trim();
  const loginPassword = (getEnv(env, overrides, "LOGIN_PASSWORD") || "").trim();

  if (!aliasList.length) throw new Error("SERVER_ALIAS_LIST 未配置");
  if (!urlList.length) throw new Error("SERVER_URL_LIST 未配置");
  if (aliasList.length !== urlList.length) throw new Error("SERVER_ALIAS_LIST 与 SERVER_URL_LIST 数量不一致");
  if (!liveNames.length) throw new Error("LIVE_NAME_LIST 未配置");
  if (!webhookKey) throw new Error("WECHAT_WEBHOOK_KEY 未配置");
  if (!loginUrl) throw new Error("LOGIN_SERVER_URL 未配置");
  if (!loginUserId) throw new Error("LOGIN_USER_ID 未配置");
  if (!loginPassword) throw new Error("LOGIN_PASSWORD 未配置");

  const servers = aliasList.map((alias, idx) => ({ alias: alias, url: urlList[idx] }));
  return { servers, liveNames, webhookKey, loginUrl, loginUserId, loginPassword };
}
```

**Step 3: 修改 run 函数**

```javascript
async function run(env, overrides = {}, fetcher = fetch) {
  const { servers, liveNames, webhookKey, loginUrl, loginUserId, loginPassword } = loadConfig(env, overrides);

  // 登录获取 token
  let token;
  try {
    console.log("正在登录获取 token...");
    token = await login(loginUrl, loginUserId, loginPassword, fetcher);
    console.log("登录成功");
  } catch (err) {
    const errorMsg = `刷码失败：账号 ${loginUserId} 登录失败 - ${err.message || err}`;
    console.error(errorMsg);
    // 推送登录失败通知
    const webhook = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${webhookKey}`;
    await fetcher(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: errorMsg } }),
    });
    throw err;
  }

  const results = await refreshAll(servers, token, liveNames, fetcher);

  for (const result of results) {
    try {
      await sendNotification(webhookKey, result, fetcher);
    } catch (err) {
      console.error(`[${result.alias}] 通知发送失败:`, err);
    }
  }

  return { results };
}
```

**Step 4: 验证语法**

Run: `node --check worker/cf_worker.js`
Expected: 无输出（语法正确）

**Step 5: Commit**

```bash
git add worker/cf_worker.js
git commit -m "feat(worker): 添加动态登录获取 token 功能"
```

---

## Task 3: 更新 wrangler.toml 配置

**Files:**
- Modify: `worker/wrangler.toml`

**Step 1: 更新环境变量配置**

将 `worker/wrangler.toml` 的 `[vars]` 部分改为：

```toml
[vars]
SERVER_ALIAS_LIST = "__SERVER_ALIAS_LIST__"
SERVER_URL_LIST = "__SERVER_URL_LIST__"
LIVE_NAME_LIST = "__LIVE_NAME_LIST__"
WECHAT_WEBHOOK_KEY = "__WECHAT_WEBHOOK_KEY__"
LOGIN_SERVER_URL = "__LOGIN_SERVER_URL__"
LOGIN_USER_ID = "__LOGIN_USER_ID__"
LOGIN_PASSWORD = "__LOGIN_PASSWORD__"
```

**Step 2: Commit**

```bash
git add worker/wrangler.toml
git commit -m "chore(worker): 更新环境变量配置，移除 SERVER_TOKEN"
```

---

## Task 4: 更新 GitHub Actions 工作流

**Files:**
- Modify: `.github/workflows/refresh-code.yml`
- Modify: `.github/workflows/deploy-worker.yml`

**Step 1: 更新 refresh-code.yml**

将 env 部分改为：

```yaml
- name: Run refresh script
  env:
    SERVER_ALIAS_LIST: ${{ secrets.SERVER_ALIAS_LIST }}
    SERVER_URL_LIST: ${{ secrets.SERVER_URL_LIST }}
    LIVE_NAME_LIST: ${{ secrets.LIVE_NAME_LIST }}
    WECHAT_WEBHOOK_KEY: ${{ secrets.WECHAT_WEBHOOK_KEY }}
    LOGIN_SERVER_URL: ${{ secrets.LOGIN_SERVER_URL }}
    LOGIN_USER_ID: ${{ secrets.LOGIN_USER_ID }}
    LOGIN_PASSWORD: ${{ secrets.LOGIN_PASSWORD }}
  run: uv run python refresh_code.py
```

**Step 2: 更新 deploy-worker.yml**

将 env 和 replacements 部分改为：

```yaml
- name: Inject secrets into wrangler.toml
  working-directory: worker
  env:
    SERVER_ALIAS_LIST: ${{ secrets.SERVER_ALIAS_LIST }}
    SERVER_URL_LIST: ${{ secrets.SERVER_URL_LIST }}
    LIVE_NAME_LIST: ${{ secrets.LIVE_NAME_LIST }}
    WECHAT_WEBHOOK_KEY: ${{ secrets.WECHAT_WEBHOOK_KEY }}
    LOGIN_SERVER_URL: ${{ secrets.LOGIN_SERVER_URL }}
    LOGIN_USER_ID: ${{ secrets.LOGIN_USER_ID }}
    LOGIN_PASSWORD: ${{ secrets.LOGIN_PASSWORD }}
  run: |
    python - <<'PY'
    import os
    from pathlib import Path

    path = Path("wrangler.toml")
    data = path.read_text()
    replacements = {
        "__SERVER_ALIAS_LIST__": os.environ.get("SERVER_ALIAS_LIST", ""),
        "__SERVER_URL_LIST__": os.environ.get("SERVER_URL_LIST", ""),
        "__LIVE_NAME_LIST__": os.environ.get("LIVE_NAME_LIST", ""),
        "__WECHAT_WEBHOOK_KEY__": os.environ.get("WECHAT_WEBHOOK_KEY", ""),
        "__LOGIN_SERVER_URL__": os.environ.get("LOGIN_SERVER_URL", ""),
        "__LOGIN_USER_ID__": os.environ.get("LOGIN_USER_ID", ""),
        "__LOGIN_PASSWORD__": os.environ.get("LOGIN_PASSWORD", ""),
    }

    for placeholder, value in replacements.items():
        data = data.replace(placeholder, value)

    path.write_text(data)
    PY
```

**Step 3: Commit**

```bash
git add .github/workflows/refresh-code.yml .github/workflows/deploy-worker.yml
git commit -m "chore(ci): 更新环境变量配置，移除 SERVER_TOKEN"
```

---

## Task 5: 更新文档

**Files:**
- Modify: `CLAUDE.md`

**Step 1: 更新环境变量表格**

将 CLAUDE.md 中的环境变量表格改为：

```markdown
## Environment Variables

| Variable | Description |
|----------|-------------|
| SERVER_ALIAS_LIST | Comma-separated server aliases (e.g., "E,W,H") |
| SERVER_URL_LIST | Comma-separated server URLs (same order as aliases) |
| LIVE_NAME_LIST | Comma-separated room name patterns to match |
| LOGIN_SERVER_URL | Login server URL for authentication |
| LOGIN_USER_ID | Login user ID |
| LOGIN_PASSWORD | Login password |
| WECHAT_WEBHOOK_KEY | WeChat Work robot webhook key |
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: 更新环境变量文档"
```

---

## Task 6: 配置 GitHub Secrets（手动）

**需要在 GitHub 仓库设置中添加以下 Secrets：**

1. `LOGIN_SERVER_URL` - 登录服务器地址（如 `live.hiwords.net`）
2. `LOGIN_USER_ID` - 登录用户名
3. `LOGIN_PASSWORD` - 登录密码

**可以删除的 Secret：**
- `SERVER_TOKEN`（不再需要）

---

## 完成检查清单

- [ ] Python 版本添加 login 功能
- [ ] Worker 版本添加 login 功能
- [ ] wrangler.toml 更新环境变量
- [ ] GitHub Actions 工作流更新
- [ ] 文档更新
- [ ] GitHub Secrets 配置
