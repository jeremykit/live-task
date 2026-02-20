# 动态登录获取 Token 设计方案

## 背景

当前刷码工具使用静态的 `SERVER_TOKEN` 环境变量进行认证，但 token 有时间限制会过期。需要改为每次执行时动态登录获取新 token。

## 设计决策

- 登录服务器地址通过环境变量配置（`LOGIN_SERVER_URL`）
- 一个 token 可用于三台服务器，只需登录一次
- 登录失败时推送企业微信通知并终止程序
- 采用简单前置登录方案，不做执行中重试

## 环境变量变更

### 新增

| 变量 | 说明 | 示例 |
|------|------|------|
| `LOGIN_SERVER_URL` | 登录服务器地址 | `live.hiwords.net` |
| `LOGIN_USER_ID` | 登录用户名 | `teacher` |
| `LOGIN_PASSWORD` | 登录密码 | `123` |

### 移除

- `SERVER_TOKEN`

## 登录接口

```
POST https://${LOGIN_SERVER_URL}/api/auth/loginAdmin
Content-Type: application/json

{"param":{"password":"${LOGIN_PASSWORD}","userId":"${LOGIN_USER_ID}"}}
```

响应中 `data.token` 为认证 token。

## 执行流程

1. 读取登录相关环境变量
2. 调用登录接口获取 token
3. 登录失败 → 推送企业微信通知 → 终止
4. 登录成功 → 使用 token 执行原有刷码流程

## 变更文件

1. `refresh_code.py` - Python 版本
2. `worker/cf_worker.js` - Cloudflare Worker 版本
3. `worker/wrangler.toml` - Worker 环境变量配置
4. `.github/workflows/*.yml` - GitHub Actions secrets
5. `CLAUDE.md` - 文档更新
