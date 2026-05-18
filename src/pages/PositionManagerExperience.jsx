import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, PieChart as PieChartIcon, RefreshCw } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  STOCK_MAX_WEIGHT_PCT,
  calculatePositions,
  generateRebalanceAdvice
} from '../app/positionManager.js';
import { groupCostBasisBySymbol } from '../app/costTracker.js';
import { readTradeLedger } from '../app/tradeLedger.js';
import { getAssetType } from '../app/assetType.js';
import { fetchQuote } from '../app/marketsApi.js';
import { formatCurrency } from '../app/accumulation.js';
import {
  Card,
  Field,
  NumberInput,
  Pill,
  SectionHeading,
  StatCard,
  TextInput,
  cx,
  primaryButtonClass,
  secondaryButtonClass
} from '../components/experience-ui.jsx';

const CHART_MARGIN = Object.freeze({ top: 12, right: 16, bottom: 8, left: 0 });
const CHART_TICK = Object.freeze({ fontSize: 11, fill: '#94a3b8' });
const CHART_TOOLTIP_STYLE = Object.freeze({ borderRadius: 12, fontSize: 12, border: '1px solid #e2e8f0' });
const CAP_LINE_STYLE = Object.freeze({ stroke: '#f97316', strokeDasharray: '4 4' });
const STORAGE_KEY = 'aiDcaPositionSnapshot';
const BAR_COLOR_STOCK = '#6366f1';
const BAR_COLOR_INDEX = '#10b981';
const BAR_COLOR_OVER = '#f43f5e';

function safeRead() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_e) { return null; }
}
function safeWrite(value) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch (_e) { /* ignore */ }
}

export function PositionManagerExperience({ embedded = false }) {
  const [totalAssets, setTotalAssets] = useState(() => safeRead()?.totalAssets || '');
  const [prices, setPrices] = useState(() => safeRead()?.prices || {});
  const [trades, setTrades] = useState(() => readTradeLedger());
  const [fetchingSymbol, setFetchingSymbol] = useState('');
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    function handle(e) {
      if (e.key === 'aiDcaTradeLedger') setTrades(readTradeLedger());
    }
    window.addEventListener('storage', handle);
    return () => window.removeEventListener('storage', handle);
  }, []);

  const shares = useMemo(() => {
    const grouped = groupCostBasisBySymbol(trades);
    const map = {};
    for (const [sym, payload] of Object.entries(grouped)) {
      if (payload.summary.remainingShares > 0) {
        map[sym] = payload.summary.remainingShares;
      }
    }
    return map;
  }, [trades]);

  const positions = useMemo(() => calculatePositions({
    totalAssets: Number(totalAssets) || 0,
    prices,
    shares
  }), [totalAssets, prices, shares]);

  const advice = useMemo(() => generateRebalanceAdvice(positions), [positions]);

  useEffect(() => {
    safeWrite({ totalAssets, prices, updatedAt: new Date().toISOString() });
  }, [totalAssets, prices]);

  const symbols = useMemo(() => Object.keys(shares).sort(), [shares]);

  async function pullPrice(symbol) {
    setFetchError('');
    setFetchingSymbol(symbol);
    try {
      const quote = await fetchQuote(symbol);
      const px = Number(
        quote?.current_price ?? quote?.price ?? quote?.regularMarketPrice ?? quote?.close
      );
      if (!Number.isFinite(px) || px <= 0) throw new Error('拉取到的价格为空');
      setPrices((prev) => ({ ...prev, [symbol]: px }));
    } catch (err) {
      setFetchError(`${symbol} 价格拉取失败：${err?.message || err}`);
    } finally {
      setFetchingSymbol('');
    }
  }

  async function pullAll() {
    for (const sym of symbols) {
      // eslint-disable-next-line no-await-in-loop
      await pullPrice(sym);
    }
  }

  const chartData = useMemo(() => positions.rows.map((row) => ({
    symbol: row.symbol,
    weight: row.weightPct,
    isOver: row.exceedsCap,
    isIndex: row.type === 'index'
  })), [positions.rows]);

  const cap = STOCK_MAX_WEIGHT_PCT;

  return (
    <div className={cx('space-y-6', embedded ? '' : 'mx-auto max-w-6xl px-6 pt-8')}>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard accent="indigo" eyebrow="总资产" value={formatCurrency(positions.totalAssets, '$ ')} note="手工录入" />
        <StatCard eyebrow="持仓市值" value={formatCurrency(positions.totalMarketValue, '$ ')} note={`${positions.rows.length} 个标獣持仓`} />
        <StatCard eyebrow="现金仓位" value={formatCurrency(positions.cashValue, '$ ')} note={`${positions.cashWeightPct}% 占比`} />
        <StatCard
          accent={positions.warnings.length ? 'rose' : 'emerald'}
          eyebrow="超仓警告"
          value={String(positions.warnings.length)}
          note={positions.warnings.length ? `个股上限 ${cap}%` : '都在限额内'}
        />
      </div>

      <Card className="min-w-0">
        <SectionHeading
          eyebrow="仓位快照"
          title="输入总资产 + 拉取现价"
          description="股数自动从交易台账读取。总资产 · 价格 存 `aiDcaPositionSnapshot`。"
          action={(
            <button type="button" className={cx(primaryButtonClass, 'inline-flex items-center gap-1.5')} onClick={pullAll} disabled={!symbols.length || !!fetchingSymbol}>
              <RefreshCw className="h-4 w-4" />
              一键拉取全部
            </button>
          )}
        />
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Field label="总资产（含现金）">
            <NumberInput value={totalAssets} onChange={(e) => setTotalAssets(e.target.value)} step="0.01" min="0" placeholder="如 50000" />
          </Field>
          <Field label="拉取头部标獣价格">
            <button type="button" className={cx(secondaryButtonClass)} disabled={!symbols[0] || !!fetchingSymbol} onClick={() => pullPrice(symbols[0])}>
              拉取 {symbols[0] || '—'}
            </button>
          </Field>
          <Field label="状态">
            {fetchingSymbol ? <Pill tone="amber">拉取中 {fetchingSymbol}</Pill> : <Pill tone="slate">空闲</Pill>}
          </Field>
        </div>
        {fetchError ? (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            <AlertTriangle className="h-4 w-4" /> {fetchError}
          </div>
        ) : null}
      </Card>

      <Card className="min-w-0">
        <SectionHeading
          eyebrow="仓位占比"
          title="各标獣权重"
          description={`个股上限 ${cap}% 橙线；宽基指数不限仓位。`}
        />

        {symbols.length === 0 ? (
          <div className="mt-5 flex flex-col items-center gap-2 py-10 text-center text-slate-500">
            <PieChartIcon className="h-8 w-8 text-slate-400" />
            <div className="text-sm">还没有持仓。先去 `#ledger` 录几笔买入记录。</div>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {symbols.map((sym) => (
                <div key={sym} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm">
                  <Pill tone={getAssetType(sym) === 'index' ? 'emerald' : 'indigo'}>{sym}</Pill>
                  <TextInput
                    value={prices[sym] ?? ''}
                    onChange={(e) => setPrices((prev) => ({ ...prev, [sym]: Number(e.target.value) || 0 }))}
                    placeholder="现价"
                  />
                  <button type="button" className={cx(secondaryButtonClass, 'h-9 px-2')} disabled={!!fetchingSymbol} onClick={() => pullPrice(sym)}>
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={CHART_MARGIN}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="symbol" tick={CHART_TICK} />
                  <YAxis tick={CHART_TICK} domain={[0, Math.max(60, ...chartData.map((d) => d.weight + 5))]} unit="%" />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  <Bar dataKey="weight" radius={[6, 6, 0, 0]}>
                    {chartData.map((d) => (
                      <Cell key={d.symbol} fill={d.isOver ? BAR_COLOR_OVER : d.isIndex ? BAR_COLOR_INDEX : BAR_COLOR_STOCK} />
                    ))}
                  </Bar>
                  {/* 超仓橙线 */}
                  <CartesianGrid y={`${cap}%`} {...CAP_LINE_STYLE} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">标獣</th>
                    <th className="px-3 py-2 text-left">类型</th>
                    <th className="px-3 py-2 text-right">股数</th>
                    <th className="px-3 py-2 text-right">价格</th>
                    <th className="px-3 py-2 text-right">市值</th>
                    <th className="px-3 py-2 text-right">占比</th>
                    <th className="px-3 py-2 text-left">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.rows.map((row) => (
                    <tr key={row.symbol} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-semibold">{row.symbol}</td>
                      <td className="px-3 py-1.5">
                        <Pill tone={row.type === 'index' ? 'emerald' : 'indigo'}>
                          {row.type === 'index' ? '宽基' : '个股'}
                        </Pill>
                      </td>
                      <td className="px-3 py-1.5 text-right">{row.shares}</td>
                      <td className="px-3 py-1.5 text-right">{formatCurrency(row.price, '$ ')}</td>
                      <td className="px-3 py-1.5 text-right">{formatCurrency(row.marketValue, '$ ')}</td>
                      <td className="px-3 py-1.5 text-right">{row.weightPct}%</td>
                      <td className="px-3 py-1.5">
                        {row.exceedsCap ? <Pill tone="rose">超仓</Pill> : <Pill tone="slate">正常</Pill>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <Card className="min-w-0">
        <SectionHeading eyebrow="建议" title="再平衡 / 超仓提醒" />
        <div className="mt-4 space-y-2">
          {advice.map((tip) => (
            <div
              key={`${tip.symbol}-${tip.kind}`}
              className={cx(
                'flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-semibold',
                tip.kind === 'trim'
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : tip.kind === 'deploy'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
              )}
            >
              <Pill tone={tip.kind === 'trim' ? 'rose' : tip.kind === 'deploy' ? 'amber' : 'emerald'}>
                {tip.kind === 'trim' ? '减仓' : tip.kind === 'deploy' ? '安现金' : 'OK'}
              </Pill>
              {tip.message}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
