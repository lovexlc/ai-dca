#!/usr/bin/env node
/**
 * Local MySQL smoke (no Workers / Hyperdrive required).
 *
 * Usage:
 *   MYSQL_URL="mysql://user:pass@127.0.0.1:3306/dbname" node scripts/smoke-mysql-hyperdrive.mjs
 *
 * Optional:
 *   MYSQL_URL=... node scripts/smoke-mysql-hyperdrive.mjs --seed
 *     creates table otc_probe_demo and inserts 3 sample rows, then ORDER BY LIMIT.
 */
import { createConnection } from 'mysql2/promise';

function parseMysqlUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'mysql:' && u.protocol !== 'mysql2:') return null;
  const database = decodeURIComponent((u.pathname || '').replace(/^\//, ''));
  return {
    host: u.hostname || '127.0.0.1',
    port: Number(u.port) || 3306,
    user: decodeURIComponent(u.username || ''),
    password: decodeURIComponent(u.password || ''),
    database: database || undefined
  };
}

async function main() {
  const url = process.env.MYSQL_URL || process.env.DATABASE_URL || '';
  const cfg = parseMysqlUrl(url);
  if (!cfg) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: 'Set MYSQL_URL=mysql://USER:PASS@HOST:3306/DB',
          workerHint:
            'After Hyperdrive is bound: curl -sS -H "Authorization: Bearer $MARKETS_ADMIN_TOKEN" "$ORIGIN/api/markets/mysql-probe"'
        },
        null,
        2
      )
    );
    process.exit(2);
  }

  const seed = process.argv.includes('--seed');
  const started = Date.now();
  let connection;
  try {
    connection = await createConnection({
      host: cfg.host,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      port: cfg.port,
      disableEval: true,
      connectTimeout: 10_000
    });

    const [pingRows] = await connection.query('SELECT 1 AS ok');
    const [versionRows] = await connection.query('SELECT VERSION() AS version');

    let sample = null;
    if (seed) {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS otc_probe_demo (
          code VARCHAR(16) PRIMARY KEY,
          name VARCHAR(64) NOT NULL,
          change_pct DOUBLE NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      await connection.query(`
        INSERT INTO otc_probe_demo (code, name, change_pct) VALUES
          ('000001', 'demo-a', 1.25),
          ('110022', 'demo-b', -0.8),
          ('161725', 'demo-c', 2.1)
        ON DUPLICATE KEY UPDATE name = VALUES(name), change_pct = VALUES(change_pct)
      `);
      const [rows] = await connection.query(
        'SELECT code, name, change_pct FROM otc_probe_demo ORDER BY change_pct DESC, code ASC LIMIT 10'
      );
      sample = rows;
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          latencyMs: Date.now() - started,
          host: cfg.host,
          port: cfg.port,
          database: cfg.database || null,
          ping: pingRows?.[0]?.ok ?? pingRows?.[0],
          version: versionRows?.[0]?.version || null,
          sample,
          next:
            'Wire Hyperdrive on markets worker and hit GET /api/markets/mysql-probe with admin bearer'
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          latencyMs: Date.now() - started,
          host: cfg.host,
          error: err instanceof Error ? err.message : String(err)
        },
        null,
        2
      )
    );
    process.exit(1);
  } finally {
    if (connection) await connection.end().catch(() => {});
  }
}

main();
