// 单方案的通知渠道启用状态。
//
// 渠道的「连接凭据」属于账号级配置（notify/client-config），这里只记录
// 「某个切换方案要往哪些已连接渠道推送」，因此存本地即可，不改动
// switchStrategySync 的 Worker 同步协议（serializeRule 白名单保持原样）。

import { SWITCH_CHANNEL_KEYS, sanitizeSwitchChannelKeys } from './switchBoardModel.js';

const STORAGE_KEY = 'aiDcaSwitchRuleChannels';

export function readSwitchRuleChannelMap() {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result = {};
    for (const [ruleId, value] of Object.entries(parsed)) {
      const id = String(ruleId || '').trim();
      if (!id || !Array.isArray(value)) continue;
      result[id] = sanitizeSwitchChannelKeys(value);
    }
    return result;
  } catch (_error) {
    return {};
  }
}

export function readSwitchRuleChannels(ruleId) {
  const map = readSwitchRuleChannelMap();
  const stored = map[String(ruleId || '').trim()];
  return Array.isArray(stored) ? stored : SWITCH_CHANNEL_KEYS.slice();
}

export function writeSwitchRuleChannels(ruleId, channels) {
  if (typeof window === 'undefined') return readSwitchRuleChannelMap();
  const id = String(ruleId || '').trim();
  if (!id) return readSwitchRuleChannelMap();
  const next = { ...readSwitchRuleChannelMap(), [id]: sanitizeSwitchChannelKeys(channels) };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (_error) {
    // 忽略配额错误：渠道选择丢失时会回退到「全部已连接渠道」。
  }
  return next;
}

export function removeSwitchRuleChannels(ruleId) {
  if (typeof window === 'undefined') return readSwitchRuleChannelMap();
  const id = String(ruleId || '').trim();
  const current = readSwitchRuleChannelMap();
  if (!id || !(id in current)) return current;
  delete current[id];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (_error) {
    // 同上，忽略配额错误。
  }
  return current;
}
