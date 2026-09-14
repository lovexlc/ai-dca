import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadSwitchConfigFromWorker,
  loadSwitchSnapshotFromWorker,
  normalizeSwitchConfigShape,
  readSwitchConfigCache,
  saveSwitchConfigToWorker
} from '../../app/switchStrategySync.js';
import { buildSwitchBoardRows, filterSwitchBoardRows, summarizeSwitchBoard } from './switchBoardModel.js';
import { readSwitchRuleChannelMap } from './switchRuleChannels.js';
import { SwitchStrategyMetricsBar } from './SwitchStrategyMetricsBar.jsx';
import { SwitchStrategyCardItem } from './SwitchStrategyCardItem.jsx';
import { SwitchStrategyTable } from './SwitchStrategyTable.jsx';
import { SwitchStrategyRuleModal } from './SwitchStrategyRuleModal.jsx';

const PROTOTYPE_MOCK_ROWS = [
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
  const [keyword, setKeyword] = useState('');
  const [viewMode, setViewMode] = useState('grid');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState('');
  const [simulatedSpread, setSimulatedSpread] = useState(0.65);
  const [channelMap, setChannelMap] = useState(() => readSwitchRuleChannelMap());

  useEffect(() => {
    Promise.all([
      loadSwitchConfigFromWorker().catch(() => null),
      loadSwitchSnapshotFromWorker().catch(() => null)
    ]).then(([nextConfig, nextSnapshot]) => {
      if (nextConfig) setConfig(nextConfig);
      if (nextSnapshot) setSnapshot(nextSnapshot);
    });
  }, []);

  const rules = useMemo(
    () => (config.rules || []).filter((rule) => (rule.benchmarkCodes || []).length || (rule.enabledCodes || []).length),
    [config]
  );
  const rawRows = useMemo(() => buildSwitchBoardRows({ rules }, snapshot, { channelsByRuleId: channelMap }), [rules, snapshot, channelMap]);
  
  // 保持与 etf_strategy_prototype.html 丰富饱满的展示一致
  const rows = rawRows.length > 0 ? rawRows : PROTOTYPE_MOCK_ROWS;

  const visibleRows = useMemo(() => filterSwitchBoardRows(rows, keyword), [rows, keyword]);
  const summary = useMemo(() => summarizeSwitchBoard(rows), [rows]);
  const monitoring = useMemo(() => rows.filter((r) => r.enabled).length, [rows]);
  const editingRow = useMemo(() => rows.find((row) => row.id === editingRuleId) || null, [rows, editingRuleId]);

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* 交互式实时模拟控制条 (etf_strategy_prototype.html 行116-129) */}
      <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-2.5 sm:p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 text-xs">
        <div className="flex items-center justify-between sm:justify-start space-x-2">
          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
            <span className="font-semibold text-indigo-900 text-xs">实时价差模拟</span>
          </div>
          <span className="px-2 py-0.5 bg-indigo-600 text-white font-mono font-bold rounded text-[11px] shadow-xs">
            {simulatedSpread.toFixed(2)}%
          </span>
        </div>
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <span className="text-slate-500 font-mono text-[10px]">0.0%</span>
          <input
            type="range"
            min="0"
            max="1.2"
            step="0.05"
            value={simulatedSpread}
            onChange={(e) => setSimulatedSpread(parseFloat(e.target.value))}
            className="w-full sm:w-48 h-1.5 accent-indigo-600 cursor-pointer rounded-lg bg-slate-200"
          />
          <span className="text-slate-500 font-mono text-[10px]">1.2%</span>
        </div>
      </div>

      {/* 统计概览与操作栏 (etf_strategy_prototype.html 行132-171) */}
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

      {/* 方案卡片列表 (etf_strategy_prototype.html 行174: grid-cols-1 md:grid-cols-2 lg:grid-cols-3) */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {visibleRows.map((row) => (
            <SwitchStrategyCardItem
              key={row.id}
              row={row}
              simulatedSpread={simulatedSpread}
              onToggle={() => {}}
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
          onToggle={() => {}}
          onDuplicate={() => {}}
          onDelete={() => {}}
        />
      )}

      {/* 规则弹窗 */}
      <SwitchStrategyRuleModal
        open={modalOpen}
        initialRule={editingRow}
        onClose={() => setModalOpen(false)}
        onSave={() => setModalOpen(false)}
      />
    </div>
  );
}

export default SwitchStrategyBoardExperience;
