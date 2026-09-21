// 页面统一读取账号加载态的 Hook。
// 不要再在各个页面里自建 loading / deleting 的 useState，改为读这里的快照；
// 页面按钮的一次完整操作用 runAccountUserAction 包住即可。
import { useSyncExternalStore } from 'react';
import {
  getAccountLoadingSnapshot,
  runAccountUserAction,
  subscribeAccountLoading
} from '../app/accountLoadingState.js';

export function useAccountLoading() {
  return useSyncExternalStore(subscribeAccountLoading, getAccountLoadingSnapshot, getAccountLoadingSnapshot);
}

/** 某个资源（如 trades/ledger）是否正在请求中，kind 可选 load / save / delete。 */
export function useAccountResourceBusy(resource, kind = '', scope = '') {
  const snapshot = useAccountLoading();
  const normalizedResource = String(resource || '');
  if (!normalizedResource) return false;
  return snapshot.operations.some(
    (operation) => operation.resource === normalizedResource
      && (!kind || operation.kind === kind)
      && (!scope || operation.scope === scope)
  );
}

export function useAccountUserResourceBusy(resource, kind = '') {
  return useAccountResourceBusy(resource, kind, 'user');
}

export { runAccountUserAction };
