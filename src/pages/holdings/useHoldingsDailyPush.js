// useHoldingsDailyPush.js
//
// 持仓页顶部的「每日收盘推送」入口状态：
// 与通知 Tab 的 holdings-rule 共用同一份服务端状态（load/saveHoldingsNotifyRule），
// 两处开关互相实时同步（以服务端为准）。

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadHoldingsNotifyRule,
  saveHoldingsNotifyRule,
  loadNotifyStatus
} from '../../app/notifySync.js';
import { aggregateByCode, buildHoldingsNotifyDigest, summarizePortfolio } from '../../app/holdingsLedgerCore.js';
import { readLedgerState } from '../../app/holdingsLedger.js';
import { CLOUD_SYNC_SESSION_EVENT, loadCloudSession } from '../../app/authClient.js';
import { showActionToast } from '../../app/toast.js';
import { trackActionResult, trackFeatureEvent } from '../../app/analytics.js';

function isLoggedInSession(session) {
  return Boolean(session?.accessToken && session?.username);
}

function buildLatestHoldingsDigest() {
  try {
    const ledger = readLedgerState();
    const aggregates = aggregateByCode(ledger?.transactions || [], ledger?.snapshotsByCode || {});
    const summary = summarizePortfolio(aggregates);
    return buildHoldingsNotifyDigest({ aggregates, summary });
  } catch {
    return null;
  }
}

export function hasAnyNotifyChannel(status) {
  if (!status || typeof status !== 'object') return false;
  const channels = status.channels || {};
  const legacy = status.configured || {};
  const setup = status.setup || {};
  return Boolean(
    channels.bark?.configured || legacy.bark ||
    channels.serverChan3?.configured || legacy.serverChan3 || setup.serverChan3?.configured ||
    channels.email?.configured ||
    channels.webWs?.configured
  );
}

function navigateToNotifyTab() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('tab', 'notify');
  window.location.href = url.toString();
}

export function useHoldingsDailyPush() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loggedIn, setLoggedIn] = useState(() => isLoggedInSession(loadCloudSession()));
  const exposedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function loadRule() {
      const session = loadCloudSession();
      const ok = isLoggedInSession(session);
      if (cancelled) return;
      setLoggedIn(ok);
      if (!ok) {
        setEnabled(false);
        setLoading(false);
        return;
      }
      try {
        const payload = await loadHoldingsNotifyRule();
        if (cancelled) return;
        setEnabled(Boolean(payload?.enabled));
      } catch {
        // 未配置与服务不可用都以「未启用」状态呈现。
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadRule();
    function handleSessionChange(event) {
      const nextSession = event?.detail?.session || loadCloudSession();
      const ok = isLoggedInSession(nextSession);
      setLoggedIn(ok);
      if (!ok) {
        setEnabled(false);
        setLoading(false);
      } else {
        loadRule();
      }
    }
    window.addEventListener(CLOUD_SYNC_SESSION_EVENT, handleSessionChange);
    return () => {
      cancelled = true;
      window.removeEventListener(CLOUD_SYNC_SESSION_EVENT, handleSessionChange);
    };
  }, []);

  // 入口曝光埋点（每个挂载周期只记一次）
  useEffect(() => {
    if (exposedRef.current) return;
    exposedRef.current = true;
    trackFeatureEvent('holdings', 'daily_push_entry_view', { loggedIn });
  }, [loggedIn]);

  const toggle = useCallback(async (nextEnabled) => {
    trackFeatureEvent('holdings', 'daily_push_toggle_click', { nextEnabled, loggedIn });
    if (saving) return { ok: false, reason: 'saving' };
    if (!loggedIn) {
      showActionToast('每日收盘推送', 'error', { description: '请先登录后再开启推送。' });
      trackActionResult('holdings', 'daily_push_toggle', 'blocked_not_logged_in', { nextEnabled });
      return { ok: false, reason: 'not_logged_in' };
    }
    if (nextEnabled) {
      // 开启前确认至少配了一个推送渠道，否则直接带去通知 Tab 配置
      try {
        const status = await loadNotifyStatus();
        if (!hasAnyNotifyChannel(status)) {
          showActionToast('每日收盘推送', 'error', { description: '请先配置通知渠道（Bark / 邮件 / Server酱³ 等），已为你打开通知设置页。' });
          trackActionResult('holdings', 'daily_push_toggle', 'blocked_no_channel', { nextEnabled });
          navigateToNotifyTab();
          return { ok: false, reason: 'no_channel' };
        }
      } catch {
        // 渠道状态读不到时不硬拦，交给服务端保存流程报错
      }
    }
    setSaving(true);
    const startedAt = Date.now();
    try {
      const digest = buildLatestHoldingsDigest();
      const payload = await saveHoldingsNotifyRule({ enabled: nextEnabled, digest });
      setEnabled(Boolean(payload?.enabled));
      showActionToast(nextEnabled ? '启用持仓提醒' : '关闭持仓提醒', 'success');
      trackActionResult('holdings', 'daily_push_toggle', 'success', {
        nextEnabled,
        hasDigest: Boolean(digest),
        digestItemCount: Array.isArray(digest?.items) ? digest.items.length : 0,
        durationMs: Date.now() - startedAt
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存持仓通知规则失败';
      showActionToast('保存持仓提醒', 'error', { description: message });
      trackActionResult('holdings', 'daily_push_toggle', 'error', {
        nextEnabled,
        durationMs: Date.now() - startedAt,
        errorMessage: message
      });
      return { ok: false, reason: 'save_error' };
    } finally {
      setSaving(false);
    }
  }, [loggedIn, saving]);

  return { enabled, loading, saving, loggedIn, toggle };
}
