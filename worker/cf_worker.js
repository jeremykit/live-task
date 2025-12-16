/**
 * Cloudflare Worker version of the live room code refresher.
 * - 获取直播列表 -> 按名称匹配 -> 刷新验证码 -> 汇总推送到企业微信
 * - 同步 Python 版逻辑，使用统一 token 和名称过滤
 */

const LIVE_LIST_PAYLOAD = {
  pageInfo: { orderBy: "", pageNum: 1, pageSize: 1000, total: 100, pages: 10 },
  param: {},
};

/**
 * 读取环境变量（优先 overrides -> env -> process.env）
 */
function getEnv(env, overrides, key) {
  if (overrides && overrides[key]) return overrides[key];
  if (env && env[key]) return env[key];
  if (typeof process !== "undefined" && process.env && process.env[key]) return process.env[key];
  return undefined;
}

function parseList(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadConfig(env, overrides = {}) {
  const aliasList = parseList(getEnv(env, overrides, "SERVER_ALIAS_LIST"));
  const urlList = parseList(getEnv(env, overrides, "SERVER_URL_LIST"));
  const liveNames = parseList(getEnv(env, overrides, "LIVE_NAME_LIST"));
  const token = (getEnv(env, overrides, "SERVER_TOKEN") || "").trim();
  const webhookKey = (getEnv(env, overrides, "WECHAT_WEBHOOK_KEY") || "").trim();

  if (!aliasList.length) throw new Error("SERVER_ALIAS_LIST 未配置");
  if (!urlList.length) throw new Error("SERVER_URL_LIST 未配置");
  if (aliasList.length !== urlList.length) throw new Error("SERVER_ALIAS_LIST 与 SERVER_URL_LIST 数量不一致");
  if (!liveNames.length) throw new Error("LIVE_NAME_LIST 未配置");
  if (!token) throw new Error("SERVER_TOKEN 未配置");
  if (!webhookKey) throw new Error("WECHAT_WEBHOOK_KEY 未配置");

  const servers = aliasList.map((alias, idx) => ({ alias: alias, url: urlList[idx] }));
  return { servers, liveNames, token, webhookKey };
}

function parseOverridesFromUrl(url) {
  const params = new URL(url).searchParams;
  const map = {};
  const mapIf = (key, param) => {
    const value = params.get(param);
    if (value) map[key] = value;
  };

  mapIf("SERVER_ALIAS_LIST", "server_alias_list");
  mapIf("SERVER_URL_LIST", "server_url_list");
  mapIf("LIVE_NAME_LIST", "live_name_list");
  mapIf("SERVER_TOKEN", "server_token");
  mapIf("WECHAT_WEBHOOK_KEY", "wechat_webhook_key");

  return map;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

async function safeError(response) {
  try {
    const body = await response.text();
    return `${response.status} ${response.statusText}: ${body}`;
  } catch (_) {
    return `${response.status} ${response.statusText}`;
  }
}

function buildHeaders(token) {
  return { "Content-Type": "application/json", Token: token };
}

async function fetchLiveList(server, token, fetcher) {
  const endpoint = `https://${server.url}/api/live/liveList`;
  const res = await fetcher(endpoint, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify(LIVE_LIST_PAYLOAD),
  });
  if (!res.ok) throw new Error(await safeError(res));

  const data = await res.json();
  if (!data?.meta?.success) throw new Error(data?.meta?.message || "获取直播列表失败");

  if (!Array.isArray(data.data)) throw new Error("直播列表数据格式异常");
  return data.data;
}

async function refreshRoomCode(server, token, liveId, fetcher) {
  const endpoint = `https://${server.url}/api/live/refreshVerifyCode`;
  const res = await fetcher(endpoint, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify({ param: String(liveId) }),
  });
  if (!res.ok) throw new Error(await safeError(res));

  const data = await safeJson(res);
  const success = Boolean(data?.meta?.success);
  const code = data?.data?.code ?? data?.meta?.message ?? "刷新失败";
  return { code: String(code), success, message: success ? "" : String(code) };
}

async function refreshMultiRoomCode(server, token, liveIds, fetcher) {
  const endpoint = `https://${server.url}/api/live/batchRefVerifyCode`;
  const res = await fetcher(endpoint, {
    method: "POST",
    headers: buildHeaders(token),
    body: JSON.stringify({ param: liveIds.join(",") }),
  });
  if (!res.ok) throw new Error(await safeError(res));

  const data = await safeJson(res);
  const success = Boolean(data?.meta?.success);
  // 响应格式: data 直接是验证码字符串，如 "3200"
  const code = data?.data ?? data?.meta?.message ?? "刷新失败";
  return { code: String(code), success, message: success ? "" : String(code) };
}

/**
 * 解析 liveNames，支持 | 分隔的多房间组
 * 例如 ["五会", "6约1|6约2", "6约3"] -> [["五会"], ["6约1", "6约2"], ["6约3"]]
 */
function parseLiveNameGroups(liveNames) {
  return liveNames.filter(Boolean).map((item) => item.split("|").map((n) => n.trim()).filter(Boolean));
}

/**
 * 根据名称组匹配直播间，返回分组结构
 * 每组包含 { names: string[], rooms: Room[] }
 */
function filterLiveRooms(liveList, liveNames) {
  const groups = parseLiveNameGroups(liveNames);
  const result = [];
  for (const nameGroup of groups) {
    const rooms = [];
    for (const target of nameGroup) {
      const matched = liveList.find((room) => {
        const name = String(room?.name || "");
        return name && name.includes(target);
      });
      if (matched) {
        rooms.push(matched);
      }
    }
    if (rooms.length > 0) {
      result.push({ names: nameGroup, rooms });
    }
  }
  return result;
}

async function refreshServer(server, token, liveNames, fetcher) {
  const result = { alias: server.alias, rooms: [], success: false, error: null };

  let liveList;
  try {
    liveList = await fetchLiveList(server, token, fetcher);
  } catch (err) {
    result.error = `获取直播列表失败：${err.message || err}`;
    return result;
  }

  const matched = filterLiveRooms(liveList, liveNames);
  if (!matched.length) {
    result.error = "未匹配到任何需要刷码的直播间";
    return result;
  }

  for (const group of matched) {
    const displayName = group.names.join("|");
    const liveIds = group.rooms.map((r) => r?.id).filter(Boolean);

    if (!liveIds.length) {
      const message = "缺少直播间 ID，无法刷码";
      result.rooms.push({ name: displayName, code: message, success: false, message });
      continue;
    }

    try {
      let refresh;
      if (liveIds.length === 1) {
        refresh = await refreshRoomCode(server, token, liveIds[0], fetcher);
      } else {
        refresh = await refreshMultiRoomCode(server, token, liveIds, fetcher);
      }
      result.rooms.push({ name: displayName, ...refresh });
    } catch (err) {
      const message = `刷码异常：${err.message || err}`;
      result.rooms.push({ name: displayName, code: message, success: false, message });
    }
  }

  result.success = result.rooms.length > 0 && result.rooms.every((room) => room.success);
  return result;
}

function buildMessage(serverResult) {
  const alias = serverResult.alias || "unknown";
  if (serverResult.error) {
    return `【${alias}】刷码失败\n原因：${serverResult.error}`;
  }

  const header = serverResult.success ? "刷码成功" : "刷码完成（部分失败）";
  const lines = [`【${alias}】${header}`];

  const rooms = serverResult.rooms || [];
  if (!rooms.length) {
    lines.push("未匹配到需要刷码的直播间");
  } else {
    for (const room of rooms) {
      if (room.success) {
        lines.push(`${room.name}:${room.code}`);
      } else {
        lines.push(`${room.name} 刷码失败：${room.message}`);
      }
    }
  }

  return lines.join("\n");
}

async function sendNotification(webhookKey, serverResult, fetcher) {
  const webhook = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${webhookKey}`;
  const payload = { msgtype: "text", text: { content: buildMessage(serverResult) } };

  const res = await fetcher(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(await safeError(res));

  const data = await safeJson(res);
  if (data?.errcode !== 0) throw new Error(data?.errmsg || "企业微信返回错误");
}

async function refreshAll(servers, token, liveNames, fetcher) {
  const results = [];
  for (const server of servers) {
    const result = await refreshServer(server, token, liveNames, fetcher);
    results.push(result);
  }
  return results;
}

async function run(env, overrides = {}, fetcher = fetch) {
  const { servers, liveNames, token, webhookKey } = loadConfig(env, overrides);
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

async function handleRequest(request, env) {
  try {
    const overrides = parseOverridesFromUrl(request.url);
    const { results } = await run(env, overrides);
    return new Response(JSON.stringify({ ok: true, results }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    const message = error?.message || "unknown error";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/refresh") return new Response("Not Found", { status: 404 });
    return handleRequest(request, env);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
};

// Allow local execution with `node cf_worker.js`
const isNode = typeof process !== "undefined" && process?.release?.name === "node";
const invokedDirectly = isNode && process.argv?.[1]?.includes("cf_worker.js");

if (invokedDirectly) {
  run(process.env)
    .then(({ results }) => {
      console.log("Refresh finished", results);
    })
    .catch((error) => {
      console.error("Execution failed", error);
      process.exit(1);
    });
}
