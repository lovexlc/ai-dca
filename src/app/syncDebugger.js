// 同步状态调试工具
import { loadCloudSession } from './authClient.js';
import { loadRememberedKey } from './secureVault.js';
import { loadCloudSyncMeta } from './cloudSync.js';
import { getClientEnd } from './syncClient.js';
import { SYNCABLE_STORAGE_KEYS } from './syncRegistry.js';

export function debugSyncStatus() {
  const session = loadCloudSession();
  const remembered = loadRememberedKey();
  const syncMeta = loadCloudSyncMeta();
  const clientEnd = getClientEnd();

  const localKeys = [];
  if (typeof window !== 'undefined' && window.localStorage) {
    SYNCABLE_STORAGE_KEYS.forEach(key => {
      const value = window.localStorage.getItem(key);
      if (value !== null) {
        localKeys.push({
          key,
          size: value.length,
          preview: value.slice(0, 50)
        });
      }
    });
  }

  const status = {
    // 登录状态
    isLoggedIn: Boolean(session?.accessToken),
    username: session?.username || null,

    // 设备信息
    clientId: clientEnd.id,
    clientType: clientEnd.type,

    // 密钥状态
    hasRememberedKey: Boolean(remembered?.rawKey),
    rememberedKeyVersion: remembered?.version || null,

    // 同步元数据
    localVersion: syncMeta?.version || null,
    remoteVersion: syncMeta?.version || null,
    lastUploadedAt: syncMeta?.uploadedAt || null,
    lastPulledAt: syncMeta?.updatedAt || null,
    appliedContentHash: syncMeta?.appliedContentHash || null,

    // 本地数据
    localKeyCount: localKeys.length,
    localKeys: localKeys.map(k => k.key),

    // 诊断
    canAutoSync: Boolean(session?.accessToken && remembered?.rawKey),
    reason: !session?.accessToken
      ? '未登录'
      : !remembered?.rawKey
        ? '未记住密钥（需要勾选"记住此设备"）'
        : '可以自动同步'
  };

  return status;
}

export function printSyncDebugInfo() {
  const status = debugSyncStatus();

  console.group('📱 同步状态诊断');
  console.log('登录状态:', status.isLoggedIn ? '✅ 已登录' : '❌ 未登录');
  if (status.username) console.log('用户名:', status.username);

  console.log('\n设备信息:');
  console.log('  设备 ID:', status.clientId);
  console.log('  设备类型:', status.clientType);

  console.log('\n密钥状态:');
  console.log('  记住密钥:', status.hasRememberedKey ? '✅ 已记住' : '❌ 未记住');
  if (status.rememberedKeyVersion) console.log('  密钥版本:', status.rememberedKeyVersion);

  console.log('\n同步元数据:');
  console.log('  本地版本:', status.localVersion || '无');
  console.log('  最后上传:', status.lastUploadedAt || '从未');
  console.log('  最后拉取:', status.lastPulledAt || '从未');
  console.log('  内容哈希:', status.appliedContentHash || '无');

  console.log('\n本地数据:');
  console.log('  可同步项数量:', status.localKeyCount);
  if (status.localKeyCount > 0) {
    console.log('  包含项:', status.localKeys.slice(0, 5).join(', '),
                status.localKeyCount > 5 ? `... 等 ${status.localKeyCount} 项` : '');
  }

  console.log('\n自动同步状态:');
  console.log('  ', status.canAutoSync ? '✅ 可以自动同步' : '❌ 无法自动同步');
  console.log('  原因:', status.reason);

  console.groupEnd();

  return status;
}

// 暴露到 window 方便调试
if (typeof window !== 'undefined') {
  window.__debugSync = printSyncDebugInfo;
}
