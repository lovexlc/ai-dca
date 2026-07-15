import { clearCloudSession, deleteCloudSyncData, loadCloudSession } from './authClient.js';
import { clearAllBrowserDataAsync } from './clearAllData.js';
import { clearRememberedKey } from './secureVault.js';
import { deleteNotifyAccountData } from './notifySync.js';

export async function clearAllLocalAndRemoteData({ confirmation = 'delete' } = {}) {
  if (String(confirmation || '') !== 'delete') {
    throw new Error('请输入 delete 确认清除数据');
  }
  const session = loadCloudSession();

  let notify = null;
  let cloud = null;
  const remoteErrors = [];
  if (session?.accessToken) {
    try {
      notify = await deleteNotifyAccountData({ confirmation });
    } catch (error) {
      remoteErrors.push(error);
    }
    try {
      cloud = await deleteCloudSyncData({ confirmation }, session);
    } catch (error) {
      remoteErrors.push(error);
    }
  }

  if (typeof window !== 'undefined' && typeof window.__aiDcaDisconnectNotifyWs === 'function') {
    try { window.__aiDcaDisconnectNotifyWs(); } catch { /* ignore */ }
  }
  // 先移除设备密钥，再清理可同步 localStorage，防止自动上传空备份。
  clearRememberedKey();
  // “清除所有”必须连同埋点/分析相关的本地 localStorage 一并删除。
  const local = await clearAllBrowserDataAsync({ preserveAnalytics: false });
  clearCloudSession();

  if (remoteErrors.length > 0) {
    const message = remoteErrors.map((error) => error?.message || String(error)).join('；');
    const error = new Error(`本机数据已清除，但云端数据清除失败：${message}`);
    error.local = local;
    error.notify = notify;
    error.cloud = cloud;
    throw error;
  }

  return { notify, cloud, local, cloudSkipped: !session?.accessToken };
}
