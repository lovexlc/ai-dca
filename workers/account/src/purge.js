export const ACCOUNT_PURGE_CONFIRMATION = "DELETE_ALL_SYNC_DATA";

const PURGE_TABLES = [
  "account_resource_history",
  "account_resources",
  "account_holdings_transactions",
  "account_holdings_transaction_meta",
  "backup_versions",
  "backups",
  "account_migrations",
];

function changes(result) {
  return Number(result?.meta?.changes || 0);
}

export async function purgeAccountData(env, userId) {
  const id = String(userId || "").trim();
  if (!id) throw new Error("缺少用户标识");
  if (!env?.DB) throw new Error("D1 binding DB missing");

  const backup = await env.DB.prepare(
    "SELECT kv_key AS kvKey FROM backups WHERE user_id = ?",
  )
    .bind(id)
    .first();
  const kvKey = String(backup?.kvKey || `backup:${id}`);

  // Delete the compatibility KV copy first. If this fails, abort before deleting
  // D1 metadata so the operation can be retried without leaving an inaccessible blob.
  if (env.SYNC_BACKUPS?.delete) {
    await env.SYNC_BACKUPS.delete(kvKey);
  }

  const results = await env.DB.batch(
    PURGE_TABLES.map((table) =>
      env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(id),
    ),
  );
  const tableChanges = PURGE_TABLES.reduce((summary, table, index) => {
    summary[table] = changes(results?.[index]);
    return summary;
  }, {});

  return {
    kvKey,
    kvDeleted: Boolean(env.SYNC_BACKUPS?.delete),
    tableChanges,
    deletedRows: Object.values(tableChanges).reduce(
      (sum, count) => sum + count,
      0,
    ),
  };
}
