import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Loader2, X } from 'lucide-react';
import { cx, primaryButtonClass } from '../../components/experience-ui.jsx';
import {
  buildSwitchRuleId,
  duplicateSwitchRule,
  loadSwitchConfigFromWorker,
  loadSwitchSnapshotFromWorker,
  normalizeSwitchConfigShape,
  readSwitchConfigCache,
  saveSwitchConfigToWorker
} from '../../app/switchStrategySync.js';
import { countRunnableSwitchRulesForUi } from '../switchStrategyViewUtils.js';
import { buildSwitchBoardRows, filterSwitchBoardRows, summarizeSwitchBoard } from './switchBoardModel.js';
import { readSwitchRuleChannelMap, removeSwitchRuleChannels, writeSwitchRuleChannels } from './switchRuleChannels.js';
import { useSwitchChannelStatus } from './useSwitchChannelStatus.js';
import { SwitchStrategyMetricsBar } from './SwitchStrategyMetricsBar.jsx';
import { SwitchStrategyCardGrid } from './SwitchStrategyCardGrid.jsx';
import { SwitchStrategyTable } from './SwitchStrategyTable.jsx';
import { SwitchStrategyRuleModal } from './SwitchStrategyRuleModal.jsx';

const VIEW_MODE_KEY = 'aiDcaSwitchBoardViewMode';

function readViewMode() {
  if (typeof window === 'undefined') return 'grid';
  return window.localStorage.getItem(VIEW_MODE_KEY) === 'table' ? 'table' : 'grid';
}

// 切换方案看板：状态与数据调度入口。
// 数据层继续使用 switchStrategySync 的 Worker 同步签名，本组件不改动任何同步协议。
export function SwitchStrategyBoardExperience({ onOpenBacktest, onOpenQuickTrade } = {}) {
  const [config, setConfig] = useState(() => normalizeSwitchConfigShape(readSwitchConfigCache()));
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [keyword, setKeyword] = useState('');
  const [viewMode, setViewMode] = useState(readViewMode);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState('');
  const [channelMap, setChannelMap] = useState(() => readSwitchRuleChannelMap());
  const { connected: channelStatus } = useSwitchChannelStatus();

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    const [nextConfig, nextSnapshot] = await Promise.all([
      loadSwitchConfigFromWorker().catch(() => null),
      loadSwitchSnapshotFromWorker().catch(() => null)
    ]);
    if (nextConfig) setConfig(nextConfig);
    if (nextSnapshot) setSnapshot(nextSnapshot);
    setRefreshing(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const rules = useMemo(
    () => (config.rules || []).filter((rule) => (rule.benchmarkCodes || []).length || (rule.enabledCodes || []).length),
    [config]
  );
  const rows = useMemo(() => buildSwitchBoardRows({ rules }, snapshot, { channelsByRuleId: channelMap }), [rules, snapshot, channelMap]);
  const visibleRows = useMemo(() => filterSwitchBoardRows(rows, keyword), [rows, keyword]);
  const summary = useMemo(() => summarizeSwitchBoard(rows), [rows]);
  const monitoring = useMemo(() => countRunnableSwitchRulesForUi(rules), [rules]);
  const editingRow = useMemo(() => rows.find((row) => row.id === editingRuleId) || null, [rows, editingRuleId]);

  const persist = useCallback(
    async (nextRules, { activeRuleId } = {}) => {
      const next = normalizeSwitchConfigShape({
        ...config,
        enabled: nextRules.some((rule) => rule.enabled),
        activeRuleId: activeRuleId || config.activeRuleId,
        rules: nextRules
      });
      const result = await saveSwitchConfigToWorker(next);
      const stored = result?.config || next;
      setConfig(stored);
      return stored;
    },
    [config]
  );

  function selectViewMode(mode) {
    const next = mode === 'table' ? 'table' : 'grid';
    setViewMode(next);
    if (typeof window !== 'undefined') window.localStorage.setItem(VIEW_MODE_KEY, next);
  }

  function openCreate() {
    setEditingRuleId('');
    setModalOpen(true);
  }

  function openEdit(row) {
    setEditingRuleId(row.id);
    setModalOpen(true);
  }

  async function toggleRule(row) {
    setBusyRuleId(row.id);
    setNotice('');
    try {
      await persist(rules.map((rule) => (rule.id === row.id ? { ...rule, enabled: !rule.enabled } : rule)));
    } catch (error) {
      setNotice(error?.message || '保存失败');
    } finally {
      setBusyRuleId('');
    }
  }

  async function duplicateRow(row) {
    setBusyRuleId(row.id);
    setNotice('');
    try {
      const next = duplicateSwitchRule(config, row.id);
      const result = await saveSwitchConfigToWorker(next);
      const stored = result?.config || next;
      setConfig(stored);
      if (stored.activeRuleId && stored.activeRuleId !== row.id) {
        setChannelMap(writeSwitchRuleChannels(stored.activeRuleId, row.channels));
      }
      setNotice(`已复制「${row.name}」，副本默认为停用状态。`);
    } catch (error) {
      setNotice(error?.message || '复制方案失败');
    } finally {
      setBusyRuleId('');
    }
  }

  async function deleteRow(row) {
    if (typeof window !== 'undefined' && !window.confirm(`确定删除「${row.name}」吗？删除后将同步 Worker。`)) return;
    setBusyRuleId(row.id);
    setNotice('');
    try {
      const remaining = rules.filter((rule) => rule.id !== row.id);
      await persist(remaining, { activeRuleId: remaining[0]?.id || '' });
      setSnapshot((current) => {
        const root = current?.snapshot;
        if (!root) return current;
        return {
          ...current,
          snapshot: { ...root, rules: (root.rules || []).filter((item) => String(item?.ruleId || item?.id || '') !== row.id) }
        };
      });
      setChannelMap(removeSwitchRuleChannels(row.id));
      setNotice('方案已删除，Worker 已同步。');
    } catch (error) {
      setNotice(error?.message || '删除方案失败');
    } finally {
      setBusyRuleId('');
    }
  }

  async function submitRule(payload) {
    setSaving(true);
    setNotice('');
    try {
      const existing = rules.find((rule) => rule.id === payload.ruleId) || null;
      const ruleId = existing?.id || buildSwitchRuleId();
      const nextRule = {
        ...(existing || {}),
        id: ruleId,
        name: payload.name,
        enabled: existing ? Boolean(existing.enabled) : true,
        benchmarkCodes: [payload.highCode],
        enabledCodes: [payload.lowCode],
        premiumClass: { [payload.highCode]: 'H', [payload.lowCode]: 'L' },
        intraSellLowerPct: payload.lowerPct,
        intraBuyOtherPct: payload.upperPct,
        holdingFundCode: payload.highCode,
        candidateFundCodes: [payload.lowCode]
      };
      const nextRules = existing ? rules.map((rule) => (rule.id === ruleId ? nextRule : rule)) : [...rules, nextRule];
      await persist(nextRules, { activeRuleId: ruleId });
      setChannelMap(writeSwitchRuleChannels(ruleId, payload.channels));
      setModalOpen(false);
      setEditingRuleId('');
      setNotice(existing ? '方案已保存，等待 Worker 重新分析。' : '方案已创建，等待 Worker 分析。');
    } catch (error) {
      setNotice(error?.message || '保存方案失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div role="status" className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
      </div>
    );
  }

  const gridProps = {
    rows: visibleRows,
    busyRuleId,
    onToggle: toggleRule,
    onEdit: openEdit,
    onDuplicate: duplicateRow,
    onDelete: deleteRow,
    onBacktest: (row) => onOpenBacktest?.(row.highCode || row.lowCode, row),
    onQuickTrade: (row) => onOpenQuickTrade?.(row.highCode || row.lowCode, row)
  };

  return (
    <div className="space-y-3">
      <SwitchStrategyMetricsBar
        total={summary.total}
        monitoring={monitoring}
        triggeredToday={summary.triggeredToday}
        keyword={keyword}
        onKeywordChange={setKeyword}
        viewMode={viewMode}
        onViewModeChange={selectViewMode}
        onCreate={openCreate}
        onRefresh={() => reload({ silent: true })}
        refreshing={refreshing}
      />

      {notice ? (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-3.5 py-2.5 text-xs leading-5 text-indigo-700">
          <span className="min-w-0">{notice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice('')} className="shrink-0 text-indigo-500 hover:text-indigo-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {!rows.length ? (
        <section className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <ArrowLeftRight className="h-8 w-8 text-slate-300" />
          <h2 className="mt-4 text-lg font-black text-slate-950">还没有切换方案</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">配置一组 H / L 双腿与双向阈值，Worker 会在交易时段持续监控利差并推送提醒。</p>
          <button type="button" onClick={openCreate} className={cx(primaryButtonClass, 'mt-6')}>新建第一个方案</button>
        </section>
      ) : !visibleRows.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          没有匹配「{keyword}」的方案。
        </section>
      ) : viewMode === 'table' ? (
        <>
          <div className="hidden lg:block">
            <SwitchStrategyTable {...gridProps} />
          </div>
          <div className="lg:hidden">
            <SwitchStrategyCardGrid {...gridProps} onCreate={openCreate} />
          </div>
        </>
      ) : (
        <SwitchStrategyCardGrid {...gridProps} onCreate={openCreate} />
      )}

      <SwitchStrategyRuleModal
        open={modalOpen}
        row={editingRow}
        channelStatus={channelStatus}
        saving={saving}
        onClose={() => {
          setModalOpen(false);
          setEditingRuleId('');
        }}
        onSubmit={submitRule}
      />
    </div>
  );
}

export default SwitchStrategyBoardExperience;
