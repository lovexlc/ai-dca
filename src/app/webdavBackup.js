// WebDAV 整包备份 / 恢复。
//
// 设计要点：
// - 浏览器依赖 Basic Auth 访问 WebDAV。默认直连，但大多数第三方 WebDAV
//   不开 CORS，因此提供可选的 `proxyUrl` 字段，通过 Cloudflare Worker 中转。
//   配套的 Worker 脚本放在 `workers/webdav-cors-proxy.js`。
// - 导出范围：localStorage 中所有以 `aiDca` 开头的 key（自动覆盖未来新增 key），并排除
//   瞬时/不可恢复项（如 `aiDcaPendingToasts`）。
// - 凭据以明文存在 localStorage，KEY = `aiDcaWebDavConfig`（用户已明确选择）。

export const WEBDAV_CONFIG_KEY = 'aiDcaWebDavConfig';
export const WEBDAV_META_KEY = 'aiDcaWebDavLastSync';

const LS_PREFIX = 'aiDca';
const TRANSIENT_KEYS = new Set(['aiDcaPendingToasts', WEBDAV_CONFIG_KEY, WEBDAV_META_KEY]);
const BACKUP_FILENAME = 'ai-dca-backup.json';
const BACKUP_VERSION = 1;

function safeLocalStorage() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}

export function loadWebDavConfig() {
  const ls = safeLocalStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(WEBDAV_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      baseUrl: String(parsed.baseUrl || ''),
      username: String(parsed.username || ''),
      password: String(parsed.password || ''),
      remoteDir: String(parsed.remoteDir || '/ai-dca-backup/'),
      proxyUrl: String(parsed.proxyUrl || '')
    };
  } catch (err) {
    console.warn('[webdav] load config failed', err);
    return null;
  }
}

export function saveWebDavConfig(config) {
  const ls = safeLocalStorage();
  if (!ls) return;
  const payload = {
    baseUrl: String(config?.baseUrl || '').trim(),
    username: String(config?.username || ''),
    password: String(config?.password || ''),
    remoteDir: normalizeDir(config?.remoteDir || '/ai-dca-backup/'),
    proxyUrl: String(config?.proxyUrl || '').trim().replace(/\/+$/, '')
  };
  ls.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(payload));
}

export function clearWebDavConfig() {
  const ls = safeLocalStorage();
  if (!ls) return;
  ls.removeItem(WEBDAV_CONFIG_KEY);
}

export function loadLastSyncMeta() {
  const ls = safeLocalStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(WEBDAV_META_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

export function writeLastSyncMeta(meta) {
  const ls = safeLocalStorage();
  if (!ls) return;
  ls.setItem(WEBDAV_META_KEY, JSON.stringify({ ...meta, at: meta?.at || new Date().toISOString() }));
}

function normalizeDir(dir) {
  let d = String(dir || '').trim();
  if (!d) return '/';
  if (!d.startsWith('/')) d = `/${d}`;
  if (!d.endsWith('/')) d = `${d}/`;
  return d;
}

function joinUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const p = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function wrapWithProxy(url, proxyUrl) {
  if (!proxyUrl) return url;
  const proxy = String(proxyUrl).replace(/\/+$/, '');
  // Worker 约定格式：<worker-url>/<full-target-url>
  return `${proxy}/${url}`;
}

function basicAuthHeader(username, password) {
  // btoa 仅支持 latin1；这里先编码成 utf8 再 btoa，兼容中文用户名/密码。
  const rawBytes = new TextEncoder().encode(`${username || ''}:${password || ''}`);
  let binary = '';
  for (let i = 0; i < rawBytes.length; i += 1) {
    binary += String.fromCharCode(rawBytes[i]);
  }
  return `Basic ${btoa(binary)}`;
}

export function collectBackupPayload() {
  const ls = safeLocalStorage();
  if (!ls) return { entries: {}, keys: [] };
  const entries = {};
  const keys = [];
  for (let i = 0; i < ls.length; i += 1) {
    const key = ls.key(i);
    if (!key) continue;
    if (!key.startsWith(LS_PREFIX)) continue;
    if (TRANSIENT_KEYS.has(key)) continue;
    const value = ls.getItem(key);
    if (value === null) continue;
    entries[key] = value; // 保留原始字符串，避免二次 JSON.parse 改变数据
    keys.push(key);
  }
  keys.sort();
  return { entries, keys };
}

export function buildBackupEnvelope() {
  const { entries, keys } = collectBackupPayload();
  const envelope = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    source: 'ai-dca',
    keyCount: keys.length,
    keys,
    payload: entries
  };
  return envelope;
}

export function applyBackupEnvelope(envelope, { wipePrefix = true } = {}) {
  const ls = safeLocalStorage();
  if (!ls) throw new Error('localStorage 不可用');
  if (!envelope || typeof envelope !== 'object') throw new Error('备份内容格式不合法');
  const payload = envelope.payload;
  if (!payload || typeof payload !== 'object') throw new Error('备份缺少 payload 字段');

  if (wipePrefix) {
    const toDelete = [];
    for (let i = 0; i < ls.length; i += 1) {
      const key = ls.key(i);
      if (!key) continue;
      if (!key.startsWith(LS_PREFIX)) continue;
      if (TRANSIENT_KEYS.has(key)) continue; // 保留 WebDAV 配置和 sync 元数据
      toDelete.push(key);
    }
    toDelete.forEach((key) => ls.removeItem(key));
  }

  let restored = 0;
  Object.entries(payload).forEach(([key, value]) => {
    if (typeof key !== 'string') return;
    if (!key.startsWith(LS_PREFIX)) return;
    if (TRANSIENT_KEYS.has(key)) return;
    if (value === null || value === undefined) return;
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    ls.setItem(key, str);
    restored += 1;
  });

  return { restoredKeyCount: restored };
}

function ensureConfig(config) {
  if (!config) throw new Error('缺少 WebDAV 配置');
  if (!config.baseUrl) throw new Error('请先填写 WebDAV 服务器地址');
  if (!config.username) throw new Error('请先填写用户名');
}

async function webdavFetch(config, path, init = {}) {
  ensureConfig(config);
  const targetUrl = joinUrl(config.baseUrl, path);
  const url = wrapWithProxy(targetUrl, config.proxyUrl);
  const headers = {
    Authorization: basicAuthHeader(config.username, config.password),
    ...(init.headers || {})
  };
  let response;
  try {
    response = await fetch(url, { ...init, headers, credentials: 'omit', mode: 'cors' });
  } catch (err) {
    const message = err?.message || '网络请求失败';
    const hint = config.proxyUrl
      ? '请确认 Worker 地址正确，且 ALLOWED_ORIGINS 已包含当前前端域名'
      : '如果是 CORS 错误，请填写「CORS 代理地址」（参考 workers/README.md）或在服务端放行跨域';
    throw new Error(`WebDAV 请求失败：${message}（${hint}）`);
  }
  return response;
}

export async function testWebDavConnection(config) {
  const response = await webdavFetch(config, normalizeDir(config.remoteDir), {
    method: 'PROPFIND',
    headers: { Depth: '0' }
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`鉴权失败（HTTP ${response.status}），请检查用户名或密码`);
  }
  if (response.status === 404) {
    // 目录不存在也算「可以连通」，UI 层会在上传时自动 MKCOL 创建
    return { ok: true, dirExists: false, status: response.status };
  }
  if (response.status >= 200 && response.status < 300) {
    return { ok: true, dirExists: true, status: response.status };
  }
  throw new Error(`连接失败：HTTP ${response.status}`);
}

async function ensureRemoteDir(config) {
  const dir = normalizeDir(config.remoteDir);
  const check = await webdavFetch(config, dir, { method: 'PROPFIND', headers: { Depth: '0' } });
  if (check.status >= 200 && check.status < 300) return;
  if (check.status === 404 || check.status === 409) {
    const mk = await webdavFetch(config, dir, { method: 'MKCOL' });
    if (mk.status >= 200 && mk.status < 300) return;
    if (mk.status === 405) return; // 已存在
    throw new Error(`创建远端目录失败：HTTP ${mk.status}`);
  }
  if (check.status === 401 || check.status === 403) {
    throw new Error(`鉴权失败（HTTP ${check.status}），请检查用户名或密码`);
  }
  throw new Error(`检查远端目录失败：HTTP ${check.status}`);
}

export async function uploadBackupToWebDav(config, envelope) {
  ensureConfig(config);
  await ensureRemoteDir(config);
  const dir = normalizeDir(config.remoteDir);
  const path = `${dir}${BACKUP_FILENAME}`;
  const body = JSON.stringify(envelope, null, 2);
  const response = await webdavFetch(config, path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body
  });
  if (response.status >= 200 && response.status < 300) {
    const meta = {
      at: new Date().toISOString(),
      bytes: body.length,
      keyCount: envelope.keyCount,
      direction: 'upload',
      remotePath: path
    };
    writeLastSyncMeta(meta);
    return meta;
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`鉴权失败（HTTP ${response.status}）`);
  }
  throw new Error(`上传失败：HTTP ${response.status}`);
}

export async function downloadBackupFromWebDav(config) {
  ensureConfig(config);
  const dir = normalizeDir(config.remoteDir);
  const path = `${dir}${BACKUP_FILENAME}`;
  const response = await webdavFetch(config, path, { method: 'GET' });
  if (response.status === 404) {
    throw new Error('远端没有找到备份文件，请先执行一次「上传到 WebDAV」');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`鉴权失败（HTTP ${response.status}）`);
  }
  if (!(response.status >= 200 && response.status < 300)) {
    throw new Error(`下载失败：HTTP ${response.status}`);
  }
  const text = await response.text();
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (err) {
    throw new Error('远端备份内容不是合法 JSON');
  }
  if (!envelope || envelope.source !== 'ai-dca' || !envelope.payload) {
    throw new Error('远端备份文件不是 ai-dca 备份，已拒绝恢复');
  }
  return { envelope, raw: text, remotePath: path };
}

export function downloadLocalBackupAsFile(envelope) {
  if (typeof document === 'undefined') return;
  const body = JSON.stringify(envelope, null, 2);
  const blob = new Blob([body], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-dca-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '—';
  }
}
