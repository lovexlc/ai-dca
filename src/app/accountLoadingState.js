// 账号相关操作（加载 / 删除 / 保存）的统一加载态。
// 所有 /api/account/v1 请求都会在 accountApi 转发层自动登记到这里，页面不再各自维护 loading 变量。
// 页面按钮可以用 runAccountUserAction 把「一次用户操作」整体登记成一个加载态，
// 即使该操作只写本地存储、由自动同步稍后回传云端，用户也能立刻看到反馈。

import { descriptorForResource } from './accountResources.js';

export const ACCOUNT_LOADING_EVENT = 'account-loading:changed';
export const ACCOUNT_LOADING_KINDS = Object.freeze(['load', 'save', 'delete']);

const KIND_VERBS = Object.freeze({ load: '加载', save: '保存', delete: '删除' });
const KIND_FALLBACK_SUBJECT = '账号数据';

// 非资源路径的可读名称，保证加载态文案任何时候都有意义。
const SPECIAL_PATH_LABELS = Object.freeze([
  [/^\/health$/, '账号服务状态'],
  [/^\/manifest$/, '账号同步清单'],
  [/^\/bundle/, '账号数据'],
  [/^\/exports\/envelope$/, '账号数据导出'],
  [/^\/migrations\/legacy\/discard$/, '旧数据清理'],
  [/^\/migrations\/legacy\/skip$/, '旧数据迁移'],
  [/^\/migrations\/legacy$/, '旧数据迁移'],
  [/^\/user\/data-notice$/, '数据处理选择']
]);

const activeOperations = new Map();
const listeners = new Set();
let sequence = 0;
let userActionDepth = 0;
let snapshot = computeSnapshot();

function normalizeKind(kind) {
  const value = String(kind || '').trim().toLowerCase();
  return ACCOUNT_LOADING_KINDS.includes(value) ? value : 'load';
}

function computeSnapshot() {
  const operations = Array.from(activeOperations.values());
  const counts = { load: 0, save: 0, delete: 0, total: operations.length };
  for (const operation of operations) counts[operation.kind] += 1;
  const userOperations = operations.filter((operation) => operation.scope === 'user');
  const primary = userOperations[userOperations.length - 1] || operations[operations.length - 1] || null;
  return Object.freeze({
    busy: operations.length > 0,
    userBusy: userOperations.length > 0,
    backgroundBusy: operations.length > userOperations.length,
    loading: counts.load > 0,
    saving: counts.save > 0,
    deleting: counts.delete > 0,
    counts: Object.freeze(counts),
    kind: primary?.kind || '',
    label: primary?.label || '',
    resources: Object.freeze(Array.from(new Set(operations.map((item) => item.resource).filter(Boolean)))),
    operations: Object.freeze(operations.map((item) => Object.freeze({ ...item })))
  });
}

function publish() {
  snapshot = computeSnapshot();
  for (const listener of Array.from(listeners)) {
    try {
      listener(snapshot);
    } catch {
      // 单个订阅方出错不能影响其它 UI 的加载态。
    }
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent(ACCOUNT_LOADING_EVENT, { detail: snapshot }));
  }
}

/** 当前加载态快照；引用只在状态变化时更新，可直接用于 useSyncExternalStore。 */
export function getAccountLoadingSnapshot() {
  return snapshot;
}

export function subscribeAccountLoading(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 登记一个进行中的账号操作，返回的 end() 幂等。 */
export function beginAccountOperation({ kind = 'load', resource = '', label = '', scope = '' } = {}) {
  sequence += 1;
  const id = `account-op-${sequence}`;
  const normalizedKind = normalizeKind(kind);
  const normalizedScope = scope === 'user' || (!scope && userActionDepth > 0) ? 'user' : 'background';
  activeOperations.set(id, {
    id,
    kind: normalizedKind,
    resource: String(resource || ''),
    label: String(label || '').trim() || `正在${KIND_VERBS[normalizedKind]}${KIND_FALLBACK_SUBJECT}`,
    scope: normalizedScope,
    startedAt: Date.now()
  });
  publish();
  let finished = false;
  return {
    id,
    end() {
      if (finished) return false;
      finished = true;
      return endAccountOperation(id);
    }
  };
}

export function endAccountOperation(id) {
  if (!activeOperations.has(id)) return false;
  activeOperations.delete(id);
  publish();
  return true;
}

/** 包装一次异步操作：无论成功还是抛错，加载态都会结束。 */
export async function trackAccountOperation(meta = {}, runner) {
  if (typeof runner !== 'function') throw new TypeError('trackAccountOperation 需要一个执行函数');
  const handle = beginAccountOperation(meta);
  try {
    return await runner();
  } finally {
    handle.end();
  }
}

// 页面删除 / 保存按钮统一入口：期间发出的账号请求都会被标记成用户操作，
// 从而与 60s 后台轮询区分开，避免全局指示器无意义闪烁。
export async function runAccountUserAction(meta = {}, runner) {
  userActionDepth += 1;
  try {
    return await trackAccountOperation({ ...meta, scope: 'user' }, runner);
  } finally {
    userActionDepth = Math.max(userActionDepth - 1, 0);
  }
}

export function isAccountLoadingKind(kind) {
  const normalized = normalizeKind(kind);
  return snapshot.operations.some((operation) => operation.kind === normalized);
}

export function isAccountResourceBusy(resource, kind = '') {
  const normalizedResource = String(resource || '');
  if (!normalizedResource) return false;
  return snapshot.operations.some(
    (operation) => operation.resource === normalizedResource && (!kind || operation.kind === normalizeKind(kind))
  );
}

/** 仅供测试与登出清理使用。 */
export function resetAccountLoadingState() {
  activeOperations.clear();
  userActionDepth = 0;
  publish();
}

function pathnameOf(path = '') {
  return `/${String(path || '').split('?')[0].replace(/^\/+/, '')}`;
}

/** 从 /api/account/v1 的相对路径还原资源名，例如 /holdings/ledger/items/tx-1 -> holdings/ledger。 */
export function resourceFromAccountPath(path = '') {
  const segments = pathnameOf(path)
    .replace(/\/items(?:\/.*)?$/, '')
    .split('/')
    .filter(Boolean);
  if (segments.length < 2) return '';
  const candidate = segments.slice(0, 2).join('/');
  return descriptorForResource(candidate) ? candidate : '';
}

function subjectForAccountPath(path = '') {
  const resource = resourceFromAccountPath(path);
  const descriptor = resource ? descriptorForResource(resource) : null;
  if (descriptor?.label) return descriptor.label;
  const pathname = pathnameOf(path);
  for (const [pattern, label] of SPECIAL_PATH_LABELS) {
    if (pattern.test(pathname)) return label;
  }
  return KIND_FALLBACK_SUBJECT;
}

/** 把一次 HTTP 请求翻译成统一加载态需要的 kind / resource / label。 */
export function describeAccountRequest({ method = 'GET', path = '' } = {}) {
  const normalizedMethod = String(method || 'GET').trim().toUpperCase();
  const kind = normalizedMethod === 'DELETE' ? 'delete' : normalizedMethod === 'GET' ? 'load' : 'save';
  return {
    kind,
    resource: resourceFromAccountPath(path),
    label: `正在${KIND_VERBS[kind]}${subjectForAccountPath(path)}`
  };
}
