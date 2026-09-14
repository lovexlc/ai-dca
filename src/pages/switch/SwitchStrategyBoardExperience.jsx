import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { readSwitchRuleChannelMap, writeSwitchRuleChannels } from './switchRuleChannels.js';
import { useSwitchChannelStatus } from './useSwitchChannelStatus.js';
import { SwitchStrategyMetricsBar } from './SwitchStrategyMetricsBar.jsx';
import { SwitchStrategyCardGrid } from './SwitchStrategyCardGrid.jsx';
import { SwitchStrategyTable } from './SwitchStrategyTable.jsx';
import { SwitchStrategyRuleModal } from './SwitchStrategyRuleModal.jsx';

const DEFAULT_MOCK_ROWS = [
  {
    id: 'mock-1',
    name: '纳指100轮动套利',
    enabled: true,
    highCode: '159632',
    lowCode: '513100',
    high: { code: '159632', name: '纳指ETF', price: 1.842, premiumPct: 2.15 },
    low: { code: '513100', name: '纳指科技', price: 1.620, premiumPct: -0.30 },
    gauge: { lowerPct: 0.1, upperPct: 0.9, spreadPct: 0.65 },
    channels: ['pc', 'email'],
    hitCount: 1,
    computedAt: '16:34:12'
  },
  {
    id: 'mock-2',
    name: '标普500跨市套利',
    enabled: true,
    highCode: '513500',
    lowCode: '159612',
    high: { code: '513500', name: '标普500', price: 2.410, premiumPct: 1.80 },
    low: { code: '159612', name: '标普ETF', price: 1.950, premiumPct: 0.90 },
    gauge: { lowerPct: 0.15, upperPct: 0.75, spreadPct: 0.45 },
    channels: ['serverchan3', 'email'],
    hitCount: 2,
    computedAt: '15:10:04'
  }
];

export function SwitchStrategyBoardExperience({ onOpenBacktest, onOpenQuickTrade } = {}) {
  const [config, setConfig] = useState(() => normalizeSwitchConfigShape(readSwitchConfigCache()));
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState('');
  const [simulatedSpread, setSimulatedSpread] = useState(0.65);
  const [channelMap, setChannelMap] = useState(() => readSwitchRuleChannelMap());

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
  const rawRows = useMemo(() => buildSwitchBoardRows({ rules }, snapshot, { channelsByRuleId: channelMap }), [rules, snapshot, channelMap]);
  const rows = rawRows.length > 0 ? rawRows : DEFAULT_MOCK_ROWS;

  const visibleRows = useMemo(() => filterSwitchBoardRows(rows, keyword), [rows, keyword]);
  const summary = useMemo(() => summarizeSwitchBoard(rows), [rows]);
  const monitoring = useMemo(() => rows.filter(r => r.enabled).length, [rows]);
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

  async function handleToggleRule(row) {
    setBusyRuleId(row.id);
    const nextRules = rules.map((rule) => (rule.id === row.id ? { ...rule, enabled: !rule.enabled } : rule));
    await persist(nextRules);
    setBusyRuleId('');
  }

  function handleSaveRule(payload) {
    setModalOpen(false);
  }

  return (
    <div className="space-y-4">
      {/* 1:1 顶部实时价差模拟条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/40 px-4 py-3 shadow-xs">
        <div className="flex items-center space-x-2">
          <span className="h-2 w-2 rounded-full bg-indigo-600 animate-pulse" />
          <span className="text-xs font-bold text-slate-900">实时价差模拟</span>
          <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-mono font-bold text-white shadow-xs">
            {simulatedSpread.toFixed(2)}%
          </span>
        </div>
        <div className="flex items-center space-x-3">
          <span className="text-xs font-mono font-semibold text-slate-400">0.0%</span>
          <input
            type="range"
            min="0"
            max="1.2"
            step="0.05"
            value={simulatedSpread}
            onChange={(e) => setSimulatedSpread(parseFloat(e.target.value))}
            className="h-2 w-44 sm:w-56 accent-indigo-600 cursor-pointer"
          />
          <span className="text-xs font-mono font-semibold text-slate-400">1.2%</span>
        </div>
      </div>

      {/* 指标条 */}
      <SwitchStrategyMetricsBar
        total={rows.length}
        monitoring={monitoring}
        triggeredToday={summary.todayTriggerCount || 3}
        keyword={keyword}
        onKeywordChange={setKeyword}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onCreate={() => { setEditingRuleId(''); setModalOpen(true); }}
      />

      {/* 看板卡片视图 (2列) / 列表视图 */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleRows.map((row) => (
            <SwitchStrategyCardItem
              key={row.id}
              row={row}
              simulatedSpread={simulatedSpread}
              busy={busyRuleId === row.id}
              onToggle={() => handleToggleRule(row)}
              onEdit={() => { setEditingRuleId(row.id); setModalOpen(true); }}
              onDuplicate={() => {}}
              onDelete={() => {}}
            />
          ))}
        </div>
      ) : (
        <SwitchStrategyTable
          rows={visibleRows}
          onEdit={(row) => { setEditingRuleId(row.id); setModalOpen(true); }}
          onToggle={handleToggleRule}
          onDuplicate={() => {}}
          onDelete={() => {}}
        />
      )}

      {/* 编辑/新建弹窗 */}
      <SwitchStrategyRuleModal
        open={modalOpen}
        initialRule={editingRow}
        onClose={() => setModalOpen(false)}
        onSave={handleSaveRule}
      />
    </div>
  );
}

export default SwitchStrategyBoardExperience;
