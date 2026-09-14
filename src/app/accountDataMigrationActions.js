import { ACCOUNT_RESOURCES } from "./accountResources.js";
import { sendAccountApiRequest } from "./accountApi.js";
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

function requireSession(session = loadCloudSession()) {
  if (!session?.accessToken) throw new Error("请先登录账户");
  return session;
}

// 转发层的通用错误文案换回迁移动作自己的提示，保持原有 UI 文案不变。
function withActionMessage(error, prefix) {
  if (
    error &&
    typeof error.message === "string" &&
    /^请求失败：HTTP/.test(error.message)
  ) {
    error.message = `${prefix}：HTTP ${error.status}`;
  }
  return error;
}

// 数据处理选择也是账号写操作，统一从 accountApi 转发层出去，自动披上统一加载态。
async function requestDataNotice(
  method,
  body = null,
  session = loadCloudSession(),
) {
  const currentSession = requireSession(session);
  let data = null;
  try {
    data = await sendAccountApiRequest(DATA_NOTICE_PATH, {
      method,
      token: currentSession.accessToken,
      body,
    });
  } catch (error) {
    throw withActionMessage(error, "选择保存失败");
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
  let remote = null;
  try {
    remote = await sendAccountApiRequest("/migrations/legacy/discard", {
      method: "POST",
      token: currentSession.accessToken,
      body: {
        confirmation: DISCARD_ACCOUNT_DATA_CONFIRMATION,
        source: "cn-migration-notice",
      },
    });
  } catch (error) {
    throw withActionMessage(error, "删除失败");
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
