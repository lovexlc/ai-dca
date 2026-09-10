import accountWorker from "./index.js";
import { ensureSchema, nowIso, sha256Hex, writeMigration } from "./store.js";
import { ensureTransactionSchema } from "./transactions.js";
import { ACCOUNT_PURGE_CONFIRMATION, purgeAccountData } from "./purge.js";
import {
  ACCOUNT_DATA_NOTICE_VERSION,
  readAccountDataNotice,
  writeAccountDataNotice,
} from "./userNotice.js";

const DISCARD_PATH = "/api/account/v1/migrations/legacy/discard";
const DATA_NOTICE_PATH = "/api/account/v1/user/data-notice";

function corsHeaders(request) {
  return {
    "access-control-allow-origin": request.headers.get("origin") || "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type, authorization, if-match",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data ?? {}), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(request),
    },
  });
}

async function readBody(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

async function requireUser(request, env) {
  const header = request.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!token)
    return {
      error: json(
        request,
        { error: "UNAUTHORIZED", message: "请先登录账户" },
        401,
      ),
    };
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT s.user_id AS userId, s.expires_at AS expiresAt, u.username AS username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
  )
    .bind(tokenHash)
    .first();
  if (!row)
    return {
      error: json(
        request,
        { error: "UNAUTHORIZED", message: "登录状态已失效，请重新登录" },
        401,
      ),
    };
  if (Date.parse(String(row.expiresAt || "")) <= Date.now()) {
    return {
      error: json(
        request,
        { error: "SESSION_EXPIRED", message: "登录已过期，请重新登录" },
        401,
      ),
    };
  }
  return {
    user: { id: String(row.userId), username: String(row.username || "") },
  };
}

async function handleDataNotice(request, env) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "GET" && request.method !== "PUT") {
    return json(
      request,
      { error: "METHOD_NOT_ALLOWED", message: "仅支持 GET 或 PUT" },
      405,
    );
  }

  try {
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    if (request.method === "GET") {
      return json(request, await readAccountDataNotice(env, auth.user.id));
    }
    const body = await readBody(request);
    if (!body)
      return json(
        request,
        { error: "INVALID_JSON", message: "请求体不是合法 JSON" },
        400,
      );
    const dataNotice = await writeAccountDataNotice(env, auth.user.id, {
      noticeVersion: body.noticeVersion || ACCOUNT_DATA_NOTICE_VERSION,
      choice: body.choice,
    });
    return json(request, dataNotice);
  } catch (error) {
    const invalid = [
      "INVALID_NOTICE_CHOICE",
      "NOTICE_VERSION_REQUIRED",
    ].includes(error?.code);
    console.error("[account] data notice failed", error);
    return json(
      request,
      {
        error: error?.code || "DATA_NOTICE_FAILED",
        message: invalid ? error.message : "账号选择保存失败，请稍后重试",
      },
      invalid ? 400 : 500,
    );
  }
}

async function handleDiscard(request, env) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") {
    return json(
      request,
      { error: "METHOD_NOT_ALLOWED", message: "仅支持 POST" },
      405,
    );
  }

  try {
    await ensureSchema(env);
    await ensureTransactionSchema(env);
    const auth = await requireUser(request, env);
    if (auth.error) return auth.error;
    const body = await readBody(request);
    if (!body)
      return json(
        request,
        { error: "INVALID_JSON", message: "请求体不是合法 JSON" },
        400,
      );
    if (body.confirmation !== ACCOUNT_PURGE_CONFIRMATION) {
      return json(
        request,
        {
          error: "CONFIRMATION_REQUIRED",
          message: "请确认永久删除全部同步数据",
        },
        400,
      );
    }

    const purged = await purgeAccountData(env, auth.user.id);
    const migration = await writeMigration(env, auth.user.id, {
      status: "skipped",
      source: String(body.source || "user-discard-all").slice(0, 60),
      legacyVersion: 0,
      importedResources: 0,
      note: `用户于 ${nowIso()} 主动删除旧密文、新资源及历史版本`,
    });
    const dataNotice = await writeAccountDataNotice(env, auth.user.id, {
      noticeVersion: ACCOUNT_DATA_NOTICE_VERSION,
      choice: "clear",
    });
    return json(request, {
      ok: true,
      username: auth.user.username,
      migration,
      dataNotice,
      purged: {
        kvDeleted: purged.kvDeleted,
        deletedRows: purged.deletedRows,
        tableChanges: purged.tableChanges,
      },
    });
  } catch (error) {
    console.error("[account] discard failed", error);
    return json(
      request,
      { error: "DISCARD_FAILED", message: "数据删除未完成，请稍后重试" },
      500,
    );
  }
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname === DISCARD_PATH) return handleDiscard(request, env);
    if (url.pathname === DATA_NOTICE_PATH)
      return handleDataNotice(request, env);
    return accountWorker.fetch(request, env, context);
  },
};
