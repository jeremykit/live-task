/**
 * Cloudflare Worker version of the live room code refresher.
 *
 * Supports both Cloudflare Workers (fetch/scheduled handlers) and Node.js/GitHub Actions
 * so you can try the same logic in different environments.
 */

/**
 * Helper to read environment variables from Cloudflare Worker `env`,
 * optional ad-hoc overrides (querystring), or Node.js `process.env`.
 * @param {Record<string, string | undefined>} env
 * @param {Record<string, string | undefined>} overrides
 * @param {string} key
 */
function getEnv(env, overrides, key) {
  if (overrides && overrides[key]) return overrides[key];
  if (env && env[key]) return env[key];
  const hasProcess = typeof process !== "undefined" && typeof process.env !== "undefined";
  if (hasProcess && process.env[key]) return process.env[key];
  return undefined;
}

function loadServers(env, overrides = {}) {
  const aliases = ["EAST", "WEST", "HEBEI"];
  const servers = [];

  for (const alias of aliases) {
    const url = getEnv(env, overrides, `${alias}_URL`);
    const token = getEnv(env, overrides, `${alias}_TOKEN`);
    const roomId = getEnv(env, overrides, `${alias}_ROOM_ID`);

    if (url && token && roomId) {
      servers.push({
        alias: alias.toLowerCase(),
        url,
        token,
        roomId,
      });
    }
  }

  if (!servers.length) {
    throw new Error(
      "No servers configured via environment variables or query overrides (e.g. ?east_url=...&east_token=...&east_room_id=...)"
    );
  }

  return servers;
}

async function refreshServer(server) {
  const endpoint = `https://${server.url}/api/live/refreshVerifyCode`;
  const payload = { param: server.roomId };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const message = await safeError(response);
      return { alias: server.alias, code: message, success: false };
    }

    const data = await response.json();
    const success = Boolean(data?.meta?.success);
    const code = data?.data?.code ?? "N/A";

    return {
      alias: server.alias,
      code: success ? code : data?.meta?.message ?? "刷新失败",
      success,
    };
  } catch (error) {
    return { alias: server.alias, code: error?.message ?? "请求异常", success: false };
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

function parseOverridesFromUrl(url) {
  const params = new URL(url).searchParams;
  const map = {};

  const aliases = ["east", "west", "hebei"];
  for (const alias of aliases) {
    const upper = alias.toUpperCase();
    const url = params.get(`${alias}_url`);
    const token = params.get(`${alias}_token`);
    const roomId = params.get(`${alias}_room_id`);

    if (url) map[`${upper}_URL`] = url;
    if (token) map[`${upper}_TOKEN`] = token;
    if (roomId) map[`${upper}_ROOM_ID`] = roomId;
  }

  const webhook = params.get("wechat_webhook_key");
  if (webhook) map.WECHAT_WEBHOOK_KEY = webhook;

  return map;
}

async function refreshAll(env, overrides) {
  const servers = loadServers(env, overrides);
  const results = [];

  for (const server of servers) {
    const result = await refreshServer(server);
    results.push(result);
  }

  return results;
}

function buildWebhookUrl(env, overrides) {
  const key = getEnv(env, overrides, "WECHAT_WEBHOOK_KEY");
  if (!key) {
    throw new Error("WECHAT_WEBHOOK_KEY is missing");
  }
  return `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${key}`;
}

async function sendNotification(env, overrides, result) {
  const webhook = buildWebhookUrl(env, overrides);
  const statusText = result.success ? "刷码成功" : "刷码失败";
  const prefix = `[${result.alias}]`;
  const details = result.success ? `验证码：${result.code}` : `原因：${result.code}`;

  const payload = {
    msgtype: "text",
    text: {
      content: `${prefix}${statusText} ${details}`,
    },
  };

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await safeError(response);
    throw new Error(`Failed to send notification: ${message}`);
  }

  const body = await response.json();
  if (body?.errcode !== 0) {
    throw new Error(`WeChat webhook error: ${body?.errmsg ?? "unknown error"}`);
  }
}

async function run(env, overrides = {}) {
  const results = await refreshAll(env, overrides);
  for (const result of results) {
    await sendNotification(env, overrides, result);
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
    const message = error?.message ?? "unknown error";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

export default {
  /**
   * HTTP trigger: useful for manual testing or when exposing the worker via a route.
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/refresh") {
      return new Response("Not Found", { status: 404 });
    }
    return handleRequest(request, env);
  },

  /**
   * CRON trigger: configure in wrangler.toml with `crons = ["0 4 * * 5"]` etc.
   */
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
