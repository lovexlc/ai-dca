import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  FileCheck,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wrench
} from 'lucide-react';
import { loadCloudSession } from '../app/authSession.js';
import { isGhostTransaction, normalizeFundCode } from '../app/holdingsLedgerBasics.js';
import { showActionToast } from '../app/toast.js';

export function DataRepairExperience({ onNavigateToHoldings } = {}) {
  const [session, setSession] = useState(() => loadCloudSession());
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [logs, setLogs] = useState([]);
  const [report, setReport] = useState(null);
  const [diffItems, setDiffItems] = useState([]);
  const logEndRef = useRef(null);

  const addLog = useCallback((text, type = 'info') => {
    setLogs((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, text, type, time: new Date().toLocaleTimeString() }]);
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // 初始扫描健康状况
  const scanHealth = useCallback(async () => {
    let localLedger = {};
    try {
      localLedger = JSON.parse(localStorage.getItem('aiDcaFundHoldingsLedger') || '{}');
    } catch {}
    const txs = Array.isArray(localLedger.transactions) ? localLedger.transactions : [];

    let ghostCount = 0;
    let placeholderNameCount = 0;
    let missingDateCount = 0;

    for (const tx of txs) {
      if (isGhostTransaction(tx)) ghostCount++;
      if (!tx.date) missingDateCount++;
      const name = String(tx.name || '').trim();
      if (!name || name === 'QDII基金' || name === '场内基金' || name === '场外基金' || name === '买入') {
        placeholderNameCount++;
      }
    }

    setReport({
      totalTxs: txs.length,
      ghostCount,
      placeholderNameCount,
      missingDateCount,
      hasCloud: Boolean(session?.accessToken),
      healthy: ghostCount === 0 && placeholderNameCount === 0 && missingDateCount === 0
    });
  }, [session]);

  useEffect(() => {
    scanHealth();
  }, [scanHealth]);

  // 执行一键智能修复
  const runRepair = async () => {
    if (running) return;
    setRunning(true);
    setLogs([]);
    setDiffItems([]);
    setCurrentStep(1);

    const diffs = [];

    try {
      addLog('正在连接天天基金官方库拉取全量标的字典 (1.8万+)...', 'process');
      await new Promise((resolve, reject) => {
        if (window.r && Array.isArray(window.r) && window.r.length > 5000) {
          resolve();
          return;
        }
        const s = document.createElement('script');
        s.src = 'https://fund.eastmoney.com/js/fundcode_search.js';
        s.charset = 'utf-8';
        s.onload = resolve;
        s.onerror = () => reject(new Error('加载官方字典失败，请检查网络连接'));
        document.head.appendChild(s);
      });

      if (!window.r || !Array.isArray(window.r)) {
        throw new Error('官方基金字典解析失败');
      }

      const fundMap = new Map();
      for (const item of window.r) {
        if (item && item[0]) {
          const c = String(item[0]).padStart(6, '0');
          fundMap.set(c, { name: item[2], type: item[3] });
        }
      }
      addLog(`官方字典就绪，已装载 ${fundMap.size} 只基金标的。`, 'success');

      // 阶段 2: 云端读取
      setCurrentStep(2);
      const token = session?.accessToken || '';
      const base = window.__AI_DCA_ACCOUNT_BASE__ || '/api/account/v1';
      let remoteRows = [];

      if (token) {
        addLog('正在读取云端数据库流水与版本锁...', 'process');
        try {
          const res = await fetch(`${base}/holdings/ledger/items?limit=1000`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          const resData = await res.json();
          remoteRows = Array.isArray(resData?.rows) ? resData.rows : [];
          addLog(`成功获取云端 ${remoteRows.length} 笔持久化流水。`, 'success');
        } catch (err) {
          addLog(`读取云端数据失败: ${err?.message || err}`, 'warn');
        }
      } else {
        addLog('当前未登录云端账号，将执行本地底账全量修复。', 'info');
      }

      // 阶段 3: 行情补充
      setCurrentStep(3);
      let localLedger = {};
      try {
        localLedger = JSON.parse(localStorage.getItem('aiDcaFundHoldingsLedger') || '{"transactions":[]}');
      } catch {}
      const localTxs = Array.isArray(localLedger.transactions) ? localLedger.transactions : [];

      const allCodes = new Set();
      for (const r of remoteRows) if (r.data?.code) allCodes.add(String(r.data.code).padStart(6, '0'));
      for (const tx of localTxs) if (tx.code) allCodes.add(String(tx.code).padStart(6, '0'));

      const missingCodes = Array.from(allCodes).filter(
        (c) => /^\d{6}$/.test(c) && !fundMap.has(c) && !c.startsWith('202') && !c.startsWith('2609')
      );

      if (missingCodes.length > 0) {
        addLog(`正在为 ${missingCodes.length} 只场内标的请求腾讯行情接口...`, 'process');
        try {
          const qList = missingCodes.map((c) => (c.startsWith('5') || c.startsWith('6') ? `s_sh${c}` : `s_sz${c}`));
          const resp = await fetch(`https://qt.gtimg.cn/q=${qList.join(',')}`);
          const text = await resp.text();
          for (const line of text.split(';')) {
            const m = line.match(/v_s_s[hz](\d+)="[^~]*~([^~]+)~/);
            if (m) fundMap.set(m[1], { name: m[2], type: '场内基金' });
          }
          addLog('场内标的行情补充完毕。', 'success');
        } catch (err) {
          addLog('场内行情接口请求超时，将沿用现有字典匹配。', 'warn');
        }
      }

      // 阶段 4: 清理幽灵记录 & 修正名称 (云端)
      setCurrentStep(4);
      let deletedCount = 0;
      let fixedCount = 0;
      const syncState = JSON.parse(localStorage.getItem('aiDcaHoldingTransactionSyncState') || '{"rows":{},"knownIds":[]}');
      if (!syncState.rows) syncState.rows = {};

      if (token && remoteRows.length > 0) {
        addLog('正在云端执行幽灵流水清理与版本对齐...', 'process');
        for (const row of remoteRows) {
          const id = String(row.id || '');
          const code = String(row.data?.code || '').trim();
          const ghost = isGhostTransaction(row.data);

          if (ghost) {
            addLog(`[云端] 🗑️ 删除异常幽灵记录: [${code}] (ID: ${id})`, 'warn');
            await fetch(`${base}/holdings/ledger/items/${encodeURIComponent(id)}`, {
              method: 'DELETE',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'If-Match': `"${row.revision}"`
              },
              body: JSON.stringify({ baseRevision: row.revision, force: false, end: { id: 'browser', type: 'DataRepair' } })
            });
            delete syncState.rows[id];
            diffs.push({ code, oldName: row.data?.name || '买入', newName: '—', action: 'delete' });
            deletedCount++;
            continue;
          }

          const normCode = code.padStart(6, '0');
          const info = fundMap.get(normCode);
          if (info && info.name && row.data?.name !== info.name) {
            addLog(`[云端] ✨ 修正名称: [${normCode}] "${row.data?.name || '(空)'}" ➔ "${info.name}"`, 'success');
            const updatedData = { ...row.data, name: info.name };
            const putResp = await fetch(`${base}/holdings/ledger/items/${encodeURIComponent(id)}`, {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                'If-Match': `"${row.revision}"`
              },
              body: JSON.stringify({ data: updatedData, baseRevision: row.revision, force: false, end: { id: 'browser', type: 'DataRepair' } })
            });
            const putJson = await putResp.json();
            const newRev = Number(putJson?.rowRevision || row.revision + 1);
            syncState.rows[id] = { revision: newRev, contentHash: putJson?.contentHash || '', localHash: '', pending: false, deleted: false };
            diffs.push({ code: normCode, oldName: row.data?.name || '(空)', newName: info.name, action: 'update' });
            fixedCount++;
          }
        }
      }

      // 阶段 5: 本地底账清洗
      setCurrentStep(5);
      addLog('正在清理本地存储与行情快照...', 'process');
      const validLocalTxs = [];
      for (const tx of localTxs) {
        if (isGhostTransaction(tx)) {
          if (!diffs.some((d) => d.code === tx.code && d.action === 'delete')) {
            diffs.push({ code: tx.code, oldName: tx.name || '买入', newName: '—', action: 'delete' });
            deletedCount++;
          }
          continue;
        }
        const normCode = String(tx.code || '').padStart(6, '0');
        const info = fundMap.get(normCode);
        if (info && info.name && tx.name !== info.name) {
          if (!diffs.some((d) => d.code === normCode && d.action === 'update')) {
            diffs.push({ code: normCode, oldName: tx.name || '(空)', newName: info.name, action: 'update' });
            fixedCount++;
          }
          tx.name = info.name;
        }
        validLocalTxs.push(tx);
      }

      localLedger.transactions = validLocalTxs;
      if (localLedger.snapshotsByCode) {
        delete localLedger.snapshotsByCode['202691'];
        delete localLedger.snapshotsByCode['260901'];
        for (const [c, snap] of Object.entries(localLedger.snapshotsByCode)) {
          if (/^202\d{3}$/.test(c)) {
            delete localLedger.snapshotsByCode[c];
            continue;
          }
          const info = fundMap.get(String(c).padStart(6, '0'));
          if (info && snap) snap.name = info.name;
        }
      }

      localStorage.setItem('aiDcaHoldingTransactionSyncState', JSON.stringify(syncState));
      localStorage.setItem('aiDcaFundHoldingsLedger', JSON.stringify(localLedger));
      window.dispatchEvent(new CustomEvent('holdings:ledger-updated', { detail: { state: localLedger } }));
      window.dispatchEvent(new Event('storage'));

      // 阶段 6: 完毕
      setCurrentStep(6);
      setDiffItems(diffs);
      addLog(`🎉 修复完成！成功修正 ${fixedCount} 笔基金名称，彻底清除 ${deletedCount} 笔异常幽灵记录。`, 'success');
      showActionToast('数据修复', 'success', {
        description: `已修正 ${fixedCount} 笔标的名称，清除 ${deletedCount} 笔幽灵记录。`
      });

      await scanHealth();
    } catch (error) {
      addLog(`❌ 修复过程中止: ${error?.message || error}`, 'error');
      showActionToast('数据修复失败', 'danger', {
        description: error?.message || '请检查网络或刷新页面后重试。'
      });
    } finally {
      setRunning(false);
    }
  };

  const steps = [
    { num: 1, label: '官方代码字典' },
    { num: 2, label: '读取云端版本' },
    { num: 3, label: '补充场内行情' },
    { num: 4, label: '云端幽灵清洗' },
    { num: 5, label: '本地底账同步' },
    { num: 6, label: '完成与生效' }
  ];

  return (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
      {/* 头部导航与标题 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Wrench className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">持仓数据诊断与修复</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            一键扫描持仓流水、拉取天天基金官方全量代码字典修正标的全称，并安全清理历史幽灵记录。
          </p>
        </div>
        {onNavigateToHoldings && (
          <button
            type="button"
            onClick={onNavigateToHoldings}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <span>返回持仓总览</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 状态诊断指标卡 */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>底账交易总笔数</span>
            <Database className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">
            {report ? report.totalTxs : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-400">本地与云端关联流水</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>待修正名称标的</span>
            <FileCheck className="h-4 w-4 text-indigo-500" />
          </div>
          <div className={`mt-2 text-2xl font-bold ${report?.placeholderNameCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
            {report ? report.placeholderNameCount : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-400">填为“QDII基金”等类别的标的</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>异常幽灵记录</span>
            <AlertTriangle className={`h-4 w-4 ${report?.ghostCount > 0 ? 'text-rose-500' : 'text-slate-400'}`} />
          </div>
          <div className={`mt-2 text-2xl font-bold ${report?.ghostCount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {report ? report.ghostCount : '—'}
          </div>
          <div className="mt-1 text-xs text-slate-400">形如 202691 错位买入</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>云端同步状态</span>
            {report?.hasCloud ? (
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-slate-400" />
            )}
          </div>
          <div className="mt-2 text-base font-bold text-slate-900">
            {report?.hasCloud ? '已登录云端账户' : '本地离线存储'}
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {report?.hasCloud ? `${session?.username || '用户'} (版本锁已就绪)` : '无需联网，本地独立生效'}
          </div>
        </div>
      </div>

      {/* 核心操作区域 */}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-bold text-slate-900">一键数据健康修复</h2>
            <p className="mt-1 text-sm text-slate-500">
              点击下方按钮，系统将自动连线官方基金字典、排查并清理幽灵流水，并将您的全部持仓名称补齐为真实全称。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={running}
              onClick={scanHealth}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
              <span>重新检测</span>
            </button>
            <button
              type="button"
              disabled={running}
              onClick={runRepair}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-indigo-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {running ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>正在修复中...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>一键诊断并自动修复</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 执行步骤进度条 */}
        {running || currentStep > 0 ? (
          <div className="mt-6 border-t border-slate-100 pt-6">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {steps.map((step) => {
                const isDone = currentStep > step.num || currentStep === 6;
                const isCurrent = currentStep === step.num && currentStep !== 6;
                return (
                  <div
                    key={step.num}
                    className={`flex items-center gap-2 rounded-xl border p-2.5 text-xs font-medium transition-colors ${
                      isDone
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : isCurrent
                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-200'
                        : 'border-slate-100 bg-slate-50 text-slate-400'
                    }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="h-4 w-4 flex-none text-emerald-600" />
                    ) : isCurrent ? (
                      <RefreshCw className="h-4 w-4 flex-none animate-spin text-indigo-600" />
                    ) : (
                      <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-slate-200 text-[10px] text-slate-600">
                        {step.num}
                      </span>
                    )}
                    <span className="truncate">{step.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* 实时执行日志 */}
        {logs.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">执行日志输出</div>
            <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-300">
              {logs.map((log) => {
                const colorClass =
                  log.type === 'success'
                    ? 'text-emerald-400'
                    : log.type === 'warn'
                    ? 'text-amber-400'
                    : log.type === 'error'
                    ? 'text-rose-400'
                    : log.type === 'process'
                    ? 'text-indigo-400'
                    : 'text-slate-400';
                return (
                  <div key={log.id} className="py-0.5 leading-relaxed">
                    <span className="text-slate-600">[{log.time}]</span>{' '}
                    <span className={colorClass}>{log.text}</span>
                  </div>
                );
              })}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* 修复变更对比清单 */}
      {diffItems.length > 0 && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">本次数据变更清单</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                共产生 {diffItems.length} 项变更，已在本地与云端实时生效。
              </p>
            </div>
            {onNavigateToHoldings && (
              <button
                type="button"
                onClick={onNavigateToHoldings}
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                <span>在持仓中查看效果</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 font-medium text-slate-600">
                <tr>
                  <th className="px-4 py-3">基金代码</th>
                  <th className="px-4 py-3">原名称</th>
                  <th className="px-4 py-3">处理动作</th>
                  <th className="px-4 py-3">修正后官方全称</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                {diffItems.map((item, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-mono font-bold text-slate-800">{item.code}</td>
                    <td className="px-4 py-2.5 text-slate-500 line-through">{item.oldName}</td>
                    <td className="px-4 py-2.5">
                      {item.action === 'delete' ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                          <Trash2 className="h-3 w-3" />
                          <span>删除幽灵记录</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>名称精准修复</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      {item.action === 'delete' ? '—' : item.newName}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 常见问题与说明 */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
        <h3 className="text-sm font-bold text-slate-900">数据修复机制与常见问题</h3>
        <div className="mt-3 grid grid-cols-1 gap-4 text-xs text-slate-600 sm:grid-cols-2">
          <div>
            <h4 className="font-semibold text-slate-800">1. 为什么会出现「202691 买入」？</h4>
            <p className="mt-1 leading-relaxed">
              用户粘贴无表头的 Excel 数据时，首列日期（如 2026-9-1）在旧版本被去除非数字字符识别为了 6 位数字代码 202691。新版解析器已增加智能内容推断，杜绝此类误识别。
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-slate-800">2. 修复后云端数据会发生冲突吗？</h4>
            <p className="mt-1 leading-relaxed">
              不会。本工作台使用云端版本锁（Revision Alignment）技术，预先读取云端当前最新版本号再进行原子覆写，全程保证 0 冲突。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
