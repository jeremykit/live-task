/**
 * Cloudflare Worker version of the live room code refresher.
 *
 * Supports both Cloudflare Workers (fetch/scheduled handlers) and Node.js/GitHub Actions
 * so you can try the same logic in different environments.
 */

/**
 * Helper to read environment variables from Cloudflare Worker `env` or Node.js `process.env`.
 * @param {Record<string, string | undefined>} env
 * @param {string} key
 */
function getEnv(env, key) {
  if (env && env[key]) return env[key];
  if (typeof process !== "undefined" && process.env && process.env[key]) {
    return process.env[key];
  }
  return undefined;
}

function loadServers(env) {
  const aliases = ["EAST", "WEST", "HEBEI"];
  const servers = [];

  for (const alias of aliases) {
    const url = getEnv(env, `${alias}_URL`);
    const token = getEnv(env, `${alias}_TOKEN`);
    const roomId = getEnv(env, `${alias}_ROOM_ID`);

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
    throw new Error("No servers configured via environment variables");
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

async function refreshAll(env) {
  const servers = loadServers(env);
  const results = [];

  for (const server of servers) {
    const result = await refreshServer(server);
    results.push(result);
  }

  return results;
}

function buildWebhookUrl(env) {
  const key = getEnv(env, "WECHAT_WEBHOOK_KEY");
  if (!key) {
    throw new Error("WECHAT_WEBHOOK_KEY is missing");
  }
  return `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${key}`;
}

async function sendNotification(env, results) {
  const webhook = buildWebhookUrl(env);
  const successCount = results.filter((r) => r.success).length;

  const lines = [`刷码成功<font color=\"warning\">${successCount}</font>/${results.length}`];
  for (const result of results) {
    const color = result.success ? "info" : "warning";
    lines.push(`<font color=\"comment\">${result.alias}</font>:<font color=\"${color}\">${result.code}</font>`);
  }

  const payload = {
    msgtype: "markdown",
    markdown: {
      content: lines.join("\n>"),
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

async function run(env) {
  const results = await refreshAll(env);
  await sendNotification(env, results);
  return { results };
}

async function handleRequest(request, env) {
  try {
    const { results } = await run(env);
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
if (typeof require !== "undefined" && require.main === module) {
  run(process.env)
    .then(({ results }) => {
      console.log("Refresh finished", results);
    })
    .catch((error) => {
      console.error("Execution failed", error);
      process.exit(1);
    });
}
