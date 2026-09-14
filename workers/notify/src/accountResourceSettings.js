// Notification channel settings stored by the account resource CRUD service.
// The notify worker keeps the legacy table as a fallback so existing accounts
// continue to work while their settings are moved to account resources.

const TABLE = 'account_resource_records';
const RESOURCE = 'notify/client-config';

function text(value = '', max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function parse(value, fallback = {}) {
  try {
    const data = JSON.parse(String(value || ''));
    return data && typeof data === 'object' ? data : fallback;
  } catch {
    return fallback;
  }
}

function active(row) {
  return Number(row?.deleted || 0) !== 1;
}

/**
 * Read the normalized notification settings from account resource rows.
 * Returns null when the account resource tables are not available or the
 * account has never written this resource. A non-null empty value is useful:
 * it represents an explicit channel deletion.
 */
export async function readAccountResourceNotifySettings(env, userId) {
  const owner = text(userId, 96);
  if (!owner || !env?.SYNC_DB?.prepare) return null;
  try {
    const result = await env.SYNC_DB.prepare(`
      SELECT record_id, payload, deleted
      FROM ${TABLE}
      WHERE user_id = ? AND resource = ?
      ORDER BY position ASC, record_id ASC
    `).bind(owner, RESOURCE).all();
    const rows = Array.isArray(result?.results) ? result.results : [];
    if (!rows.length) return null;

    const settings = {
      barkDeviceKey: '',
      serverChan3: {},
      email: {}
    };
    let meta = {};
    const channels = new Set();
    for (const row of rows) {
      const id = String(row?.record_id || '');
      if (id.startsWith('channel:')) channels.add(id);
      if (!active(row)) continue;
      const value = parse(row?.payload);
      if (id === '__meta__') {
        meta = value;
      } else if (id === 'channel:bark') {
        settings.barkDeviceKey = text(value.barkDeviceKey, 512);
      } else if (id === 'channel:serverchan3') {
        settings.serverChan3 = {
          uid: text(value.serverChan3Uid || value.serverChan3?.uid, 240),
          sendKey: text(value.serverChan3SendKey || value.serverChan3?.sendKey, 512)
        };
      } else if (id === 'channel:email') {
        settings.email = value.email && typeof value.email === 'object' ? value.email : value;
      }
    }
    return { settings, meta, channels, hasResource: true };
  } catch {
    return null;
  }
}

export function mergeAccountResourceNotifySettings(base = {}, resource = null) {
  if (!resource?.hasResource) return base;
  const settings = resource.settings || {};
  const channels = resource.channels instanceof Set ? resource.channels : new Set();
  return {
    ...base,
    ...resource.meta,
    ...(channels.has('channel:bark') ? { barkDeviceKey: text(settings.barkDeviceKey || '', 512) } : {}),
    ...(channels.has('channel:serverchan3') ? { serverChan3: settings.serverChan3 && typeof settings.serverChan3 === 'object' ? settings.serverChan3 : {} } : {}),
    ...(channels.has('channel:email') ? { email: settings.email && typeof settings.email === 'object' ? settings.email : {} } : {})
  };
}
