export const ACCOUNT_DATA_NOTICE_VERSION = "plain-resource-sync-v1";
export const ACCOUNT_DATA_NOTICE_CHOICES = Object.freeze([
  "migrate",
  "clear",
  "source",
  "continue",
]);

const NOTICE_CHOICE_SET = new Set(ACCOUNT_DATA_NOTICE_CHOICES);
const readyDatabases = new WeakSet();
const USER_NOTICE_COLUMNS = [
  "ALTER TABLE users ADD COLUMN account_data_notice_version TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN account_data_notice_choice TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN account_data_notice_updated_at TEXT NOT NULL DEFAULT ''",
];

function isDuplicateColumnError(error) {
  return /duplicate column name/i.test(String(error?.message || error || ""));
}

export function normalizeAccountDataNotice(row = {}) {
  const noticeVersion = String(
    row?.noticeVersion ?? row?.account_data_notice_version ?? "",
  );
  const choice = String(
    row?.choice ?? row?.account_data_notice_choice ?? "",
  );
  const updatedAt = String(
    row?.updatedAt ?? row?.account_data_notice_updated_at ?? "",
  );
  return {
    noticeVersion,
    choice: NOTICE_CHOICE_SET.has(choice) ? choice : "",
    updatedAt,
  };
}

export async function ensureUserNoticeColumns(env) {
  const database = env?.DB;
  if (!database) throw new Error("D1 binding DB missing");
  if (readyDatabases.has(database)) return;
  for (const sql of USER_NOTICE_COLUMNS) {
    try {
      await database.prepare(sql).run();
    } catch (error) {
      if (!isDuplicateColumnError(error)) throw error;
    }
  }
  readyDatabases.add(database);
}

export async function readAccountDataNotice(env, userId) {
  await ensureUserNoticeColumns(env);
  const row = await env.DB
    .prepare(`SELECT
      account_data_notice_version AS noticeVersion,
      account_data_notice_choice AS choice,
      account_data_notice_updated_at AS updatedAt
      FROM users WHERE id = ?`)
    .bind(String(userId || ""))
    .first();
  return normalizeAccountDataNotice(row || {});
}

export async function writeAccountDataNotice(
  env,
  userId,
  { noticeVersion = ACCOUNT_DATA_NOTICE_VERSION, choice, updatedAt = "" } = {},
) {
  const normalizedChoice = String(choice || "").trim().toLowerCase();
  if (!NOTICE_CHOICE_SET.has(normalizedChoice)) {
    const error = new Error("通知选择不合法");
    error.code = "INVALID_NOTICE_CHOICE";
    throw error;
  }
  const normalizedVersion = String(noticeVersion || "").trim().slice(0, 80);
  if (!normalizedVersion) {
    const error = new Error("通知版本不能为空");
    error.code = "NOTICE_VERSION_REQUIRED";
    throw error;
  }
  await ensureUserNoticeColumns(env);
  const timestamp = String(updatedAt || new Date().toISOString());
  const result = await env.DB
    .prepare(`UPDATE users SET
      account_data_notice_version = ?,
      account_data_notice_choice = ?,
      account_data_notice_updated_at = ?
      WHERE id = ?`)
    .bind(normalizedVersion, normalizedChoice, timestamp, String(userId || ""))
    .run();
  if (Number(result?.meta?.changes || 0) < 1) {
    const error = new Error("用户不存在");
    error.code = "USER_NOT_FOUND";
    throw error;
  }
  return {
    noticeVersion: normalizedVersion,
    choice: normalizedChoice,
    updatedAt: timestamp,
  };
}
