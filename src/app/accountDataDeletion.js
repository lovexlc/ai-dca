import { clearCloudSession, deleteCloudSyncData, loadCloudSession } from './authClient.js';
import { clearAllBrowserDataAsync } from './clearAllData.js';
import { clearRememberedKey } from './secureVault.js';
import { deleteNotifyAccountData } from './notifySync.js';

export async function clearAllLocalAndRemoteData({ confirmation = 'delete' } = {}) {
  if (String(confirmation || '') !== 'delete') {
    throw new Error('请输入 delete 确认清除数据');
  }
  const session = loadCloudSession();
  if (!session?.accessToken) throw new Error('请先登录账户后再清除云端数据');

  const notify = await deleteNotifyAccountData({ confirmation });
  const cloud = await deleteCloudSyncData({ confirmation }, session);

  if (typeof window !== 'undefined' && typeof window.__aiDcaDisconnectNotifyWs === 'function') {
    try { window.__aiDcaDisconnectNotifyWs(); } catch { /* ignore */ }
  }
  // 先移除设备密钥，再清理可同步 localStorage，防止自动上传空备份。
  clearRememberedKey();
  const local = await clearAllBrowserDataAsync({ preserveAnalytics: true });
  clearCloudSession();
  return { notify, cloud, local };
}
