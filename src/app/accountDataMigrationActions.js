import { ACCOUNT_RESOURCES } from "./accountResources.js";
import { getAccountApiBase } from "./accountApi.js";
import { loadCloudSession } from "./authSession.js";
import { clearAllLocalDataAsync } from "./clearAllData.js";
import { purgeAccountLocalStorageKeys } from "./accountRuntimeStore.js";
import {
  ACCOUNT_MIGRATION_EVENT,
  ACCOUNT_MIGRATION_STATE_KEY,
} from "./legacyMigration.js";
import { ACCOUNT_SYNC_STATE_KEY } from "./resourceSync.js";
import { HOLDING_TRANSACTION_SYNC_STATE_KEY } from "./holdingTransactionsSync.js";
import { SECURE_SYNC_REMEMBERED_KEY } from "./secureVault.js";

export const DISCARD_ACCOUNT_DATA_CONFIRMATION = "DELETE_ALL_SYNC_DATA";
export const ACCOUNT_DATA_NOTICE_VERSION = "plain-resource-sync-v1";

const ACCOUNT_DATA_NOTICE_CHOICES = new Set([
  "migrate",
  "clear",
  "source",
  "continue",
]);
const DATA_NOTICE_PATH = "/user/data-notice";
const EXTRA_LOCAL_KEYS = [
  "aiDcaAccountAssignments",
  "aiDcaCloudSyncMeta",
  "aiDcaDemoDataMeta",
  "aiDcaTradeLedgerArchive",
  ACCOUNT_MIGRATION_STATE_KEY,
  ACCOUNT_SYNC_STATE_KEY,
  HOLDING_TRANSACTION_SYNC_STATE_KEY,
  SECURE_SYNC_REMEMBERED_KEY,
];

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

function requireSession(session = loadCloudSession()) {
  if (!session?.accessToken) throw new Error("请先登录账户");
  return session;
}

async function requestDataNotice(method, body = null, session = loadCloudSession()) {
  const currentSession = requireSession(session);
  const response = await fetch(`${getAccountApiBase()}${DATA_NOTICE_PATH}`, {
    method,
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${currentSession.accessToken}`,
    },
    body: body === null ? undefined : JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) {
    const error = new Error(
      data?.message || data?.error || `选择保存失败：HTTP ${response.status}`,
    );
    error.status = response.status;
    error.code = data?.error || "";
    error.data = data;
    throw error;
  }
  return {
    noticeVersion: String(data?.noticeVersion || ""),
    choice: String(data?.choice || ""),
    updatedAt: String(data?.updatedAt || ""),
  };
}

export function hasSeenAccountDataNotice(dataNotice = {}) {
  return (
    dataNotice?.noticeVersion === ACCOUNT_DATA_NOTICE_VERSION &&
    ACCOUNT_DATA_NOTICE_CHOICES.has(String(dataNotice?.choice || ""))
  );
}

export function fetchAccountDataNotice(session = loadCloudSession()) {
  return requestDataNotice("GET", null, session);
}

export function saveAccountDataNoticeChoice(
  choice,
  session = loadCloudSession(),
) {
  const normalizedChoice = String(choice || "").trim().toLowerCase();
  if (!ACCOUNT_DATA_NOTICE_CHOICES.has(normalizedChoice)) {
    throw new Error("通知选择不合法");
  }
  return requestDataNotice(
    "PUT",
    {
      noticeVersion: ACCOUNT_DATA_NOTICE_VERSION,
      choice: normalizedChoice,
    },
    session,
  );
}

export function listMigrationLocalDataKeys() {
  return Array.from(
    new Set([
      ...ACCOUNT_RESOURCES.map((item) => item.key).filter(Boolean),
      ...EXTRA_LOCAL_KEYS,
    ]),
  );
}

export async function discardRemoteAndLocalAccountData(
  session = loadCloudSession(),
) {
  const currentSession = requireSession(session);
  const response = await fetch(
    `${getAccountApiBase()}/migrations/legacy/discard`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${currentSession.accessToken}`,
      },
      body: JSON.stringify({
        confirmation: DISCARD_ACCOUNT_DATA_CONFIRMATION,
        source: "cn-migration-notice",
      }),
    },
  );
  const remote = await readJson(response);
  if (!response.ok) {
    const error = new Error(
      remote?.message || remote?.error || `删除失败：HTTP ${response.status}`,
    );
    error.status = response.status;
    error.code = remote?.error || "";
    error.data = remote;
    throw error;
  }

  // Remote deletion succeeds first. Then remove both the runtime mirror and the
  // persistent browser values so an active account read guard cannot leave stale data behind.
  await clearAllLocalDataAsync().catch(() => null);
  purgeAccountLocalStorageKeys(listMigrationLocalDataKeys());

  const localState = {
    status: "skipped",
    reason: "user-discarded-all-data",
    updatedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(
      ACCOUNT_MIGRATION_STATE_KEY,
      JSON.stringify(localState),
    );
    window.dispatchEvent(
      new CustomEvent(ACCOUNT_MIGRATION_EVENT, { detail: localState }),
    );
  } catch {
    // The server has already completed the destructive operation; reloading will re-read it.
  }
  return {
    status: "skipped",
    remote,
    dataNotice: remote?.dataNotice || null,
    localState,
  };
}
