import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { cx } from '../../components/experience-ui.jsx';
import { formatNumber, formatSignedPercent } from './marketDisplayUtils.js';
import { formatCnAmount, formatCnMoney, formatFinancialCompact } from './marketFinancialFormatters.js';
const FINANCIAL_TABS = [
  { key: 'income', label: '损益表' },
  { key: 'balance', label: '资产负债表' },
  { key: 'cashflow', label: '现金流量' },
];
const FINANCIAL_PERIODS = [
  { key: 'quarterly', label: '季度' },
  { key: 'annual', label: '年度' },
];
const FINANCIAL_CHART_MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };
const FINANCIAL_AXIS_TICK = { fontSize: 11, fill: '#5f6368' };
const FINANCIAL_TOOLTIP_STYLE = { borderRadius: 10, borderColor: '#e8eaed', boxShadow: 'none' };
const FINANCIAL_FIELDS = {
  income: [
    ['totalRevenue', '收入'],
    ['grossProfit', '毛利润'],
    ['operatingIncome', '营业利润'],
    ['netIncome', '净利润'],
  ],
  balance: [
    ['totalAssets', '总资产'],
    ['totalLiab', '总负债'],
    ['totalStockholderEquity', '股东权益'],
    ['cash', '现金'],
  ],
  cashflow: [
    ['totalCashFromOperatingActivities', '经营现金流'],
    ['capitalExpenditures', '资本开支'],
    ['freeCashFlow', '自由现金流'],
    ['changeInCash', '现金净变化'],
  ],
};
function financialFieldLabel(key) {
  const all = Object.values(FINANCIAL_FIELDS).flat();
  return (all.find(([k]) => k === key) || [key, key])[1];
}
function financialValue(row, key) {
  if (!row || !row.fields) return null;
  if (key === 'freeCashFlow') {
    const op = Number(row.fields.totalCashFromOperatingActivities);
    const capex = Number(row.fields.capitalExpenditures);
    return Number.isFinite(op) && Number.isFinite(capex) ? op + capex : null;
  }
  const n = Number(row.fields[key]);
  return Number.isFinite(n) ? n : null;
}
export function FinancialsPanel({ financials, loading }) {
  const [statement, setStatement] = useState('income');
  const [period, setPeriod] = useState('quarterly');
  const rows = useMemo(() => {
    const raw = financials?.statements?.[statement]?.[period];
    return (Array.isArray(raw) ? raw : []).slice().sort((a, b) => Number(a.endDate || 0) - Number(b.endDate || 0)).slice(-6);
  }, [financials, statement, period]);
  const fields = FINANCIAL_FIELDS[statement] || [];
  const chartRows = rows.map((row) => {
    const out = { period: row.period?.slice(0, 7) || row.period };
    fields.slice(0, 3).forEach(([key]) => { out[key] = financialValue(row, key); });
    return out;
  });
  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-64 animate-pulse rounded-lg bg-[#f1f3f4]" />
        <div className="h-52 animate-pulse rounded-xl bg-[#f1f3f4]" />
        <div className="h-36 animate-pulse rounded-xl bg-[#f1f3f4]" />
      </div>
    );
  }
  if (!rows.length) {
    return <div className="rounded-xl border border-[#e8eaed] bg-[#f8fafd] px-4 py-6 text-sm text-[#5f6368]">暂无财务报表数据。</div>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-full bg-[#f1f3f4] p-1">
          {FINANCIAL_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatement(tab.key)}
              className={cx('rounded-full px-3 py-1 text-[13px] font-medium transition', statement === tab.key ? 'bg-white text-[#1f1f1f] shadow-[0_1px_2px_rgba(60,64,67,0.12)]' : 'text-[#5f6368] hover:text-[#1f1f1f]')}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-full border border-[#dadce0] bg-white p-0.5">
          {FINANCIAL_PERIODS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setPeriod(tab.key)}
              className={cx('rounded-full px-3 py-1 text-[12px] font-medium transition', period === tab.key ? 'bg-[#e8f0fe] text-[#1a73e8]' : 'text-[#5f6368] hover:bg-[#f1f3f4]')}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-56 rounded-xl border border-[#e8eaed] bg-white p-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartRows} margin={FINANCIAL_CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f3f4" vertical={false} />
            <XAxis dataKey="period" tick={FINANCIAL_AXIS_TICK} />
            <YAxis tickFormatter={formatFinancialCompact} tick={FINANCIAL_AXIS_TICK} width={48} />
            <Tooltip formatter={(v, name) => [formatFinancialCompact(v), financialFieldLabel(name)]} contentStyle={FINANCIAL_TOOLTIP_STYLE} />
            {fields.slice(0, 3).map(([key], idx) => (
              <Bar key={key} dataKey={key} fill={['#1a73e8', '#34a853', '#f9ab00'][idx % 3]} radius={[4, 4, 0, 0]} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[#e8eaed] bg-white">
        <table className="min-w-[720px] w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-[#f8fafd] text-[12px] text-[#5f6368]">
            <tr>
              <th className="sticky left-0 z-20 border-b border-[#e8eaed] bg-[#f8fafd] px-3 py-2 text-left font-medium">指标</th>
              {rows.map((row) => <th key={row.period} className="border-b border-[#e8eaed] px-3 py-2 text-right font-medium tabular-nums">{row.period}</th>)}
            </tr>
          </thead>
          <tbody>
            {fields.map(([key, label]) => (
              <tr key={key} className="hover:bg-[#f8fafd]">
                <td className="sticky left-0 border-b border-[#f1f3f4] bg-white px-3 py-2 font-medium text-[#1f1f1f]">{label}</td>
                {rows.map((row) => <td key={row.period} className="border-b border-[#f1f3f4] px-3 py-2 text-right tabular-nums text-[#1f1f1f]">{formatFinancialCompact(financialValue(row, key))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function NavInsightCard({ premiumState }) {
  const data = premiumState && premiumState.data;
  if (premiumState?.loading && !data) {
    return (
      <div className="mt-3 rounded-xl border border-[#e8eaed] bg-[#f8fafd] p-3 text-sm text-[#5f6368]">
        <div className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> 正在获取净值…</div>
      </div>
    );
  }
  if (premiumState?.error) {
    return (
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
        净值暂不可用：{premiumState.error}
      </div>
    );
  }
  if (!data) return null;
  return (
    <div className="mt-3 rounded-xl border border-[#e8eaed] bg-[#f8fafd] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-[#5f6368]">上一工作日净值</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-[#1f1f1f]">{formatNumber(data.baseNav, 4)}</div>
          {data.navDate ? <div className="mt-1 text-[11px] text-[#9aa0a6]">确认日期 {data.navDate}</div> : null}
        </div>
        <div className="text-right text-[12px] leading-5 text-[#5f6368]">
          <div>场内价格 <span className="font-medium tabular-nums text-[#1f1f1f]">{formatNumber(data.price, 4)}</span></div>
          <div>最新 IOPV <span className="font-medium tabular-nums text-[#1f1f1f]">{formatNumber(data.iopv, 4)}</span></div>
          <div>最新溢价 <span className={cx('font-medium tabular-nums', Number(data.premiumPercent) > 0 ? 'text-[#a50e0e]' : Number(data.premiumPercent) < 0 ? 'text-[#137333]' : 'text-[#1f1f1f]')}>{formatSignedPercent(data.premiumPercent)}</span></div>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-[#9aa0a6]">净值取基金最新确认 NAV，场内基金盘中交易仍以价格为准。</p>
    </div>
  );
}


export function CnFundFlowPanel({ fundData, loading }) {
  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-[#f1f3f4]" />;
  const flow = fundData?.capitalFlow;
  const bidAskRows = fundData?.orderBook?.levels || [];
  if (!flow && !bidAskRows.length) return <div className="rounded-xl border border-[#e8eaed] bg-[#f8fafd] px-4 py-6 text-sm text-[#5f6368]">暂无资金和盘口数据。</div>;
  return (
    <div className="space-y-5">
      <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-between border-b border-[#e8eaed] py-2"><span className="text-[#5f6368]">主力净流入</span><span className="font-medium tabular-nums text-[#1f1f1f]">{flow ? formatCnMoney(flow.mainNetInflow) : '暂无'}</span></div>
        <div className="flex items-center justify-between border-b border-[#e8eaed] py-2"><span className="text-[#5f6368]">3日净流入</span><span className="font-medium tabular-nums text-[#1f1f1f]">{'暂无'}</span></div>
        <div className="flex items-center justify-between border-b border-[#e8eaed] py-2"><span className="text-[#5f6368]">5日净流入</span><span className="font-medium tabular-nums text-[#1f1f1f]">{'暂无'}</span></div>
        <div className="flex items-center justify-between border-b border-[#e8eaed] py-2"><span className="text-[#5f6368]">20日净流入</span><span className="font-medium tabular-nums text-[#1f1f1f]">{'暂无'}</span></div>
      </div>
      <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {[
          ['主力净流入占比', flow?.mainNetInflowPct, true],
          ['超大单净流入', flow?.superLarge], ['大单净流入', flow?.large],
          ['中单净流入', flow?.medium], ['小单净流入', flow?.small],
        ].map(([label, value, percent]) => (
          <div key={label} className="flex items-center justify-between border-b border-[#e8eaed] py-2">
            <span className="text-[#5f6368]">{label}</span>
            <span className="font-medium tabular-nums">{value == null ? '暂无' : percent ? formatSignedPercent(value) : formatCnMoney(value)}</span>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-[#e8eaed] bg-white">
        <div className="border-b border-[#e8eaed] bg-[#f8fafd] px-3 py-2 text-sm font-semibold text-[#1f1f1f]">盘口</div>
        <div className="grid grid-cols-5 gap-0 text-right text-[12px] sm:text-sm">
          <div className="px-2 py-2 text-left font-medium text-[#5f6368]">档位</div><div className="px-2 py-2 font-medium text-[#5f6368]">买价</div><div className="px-2 py-2 font-medium text-[#5f6368]">买量</div><div className="px-2 py-2 font-medium text-[#5f6368]">卖价</div><div className="px-2 py-2 font-medium text-[#5f6368]">卖量</div>
          {bidAskRows.map((it) => (
            <div key={it.level} className="contents">
              <div className="border-t border-[#f1f3f4] px-2 py-2 text-left text-[#5f6368]">{it.level}档</div>
              <div className="border-t border-[#f1f3f4] px-2 py-2 tabular-nums text-[#1f1f1f]">{formatNumber(it.bidPrice, 3)}</div>
              <div className="border-t border-[#f1f3f4] px-2 py-2 tabular-nums text-[#1f1f1f]">{formatCnAmount(it.bidVolume)}</div>
              <div className="border-t border-[#f1f3f4] px-2 py-2 tabular-nums text-[#1f1f1f]">{formatNumber(it.askPrice, 3)}</div>
              <div className="border-t border-[#f1f3f4] px-2 py-2 tabular-nums text-[#1f1f1f]">{formatCnAmount(it.askVolume)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CnFundReportPanel() {
  return <div className="rounded-xl border border-[#e8eaed] bg-[#f8fafd] px-4 py-6 text-sm text-[#5f6368]">暂无基金年报数据。</div>;
}
