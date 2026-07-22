import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getXueqiuQuote } from '../../app/xueqiuQuote.js';
import { cx } from '../../components/experience-ui.jsx';
import { MARKET_EMPTY_VALUE, formatNumber, formatSignedPercent } from './marketDisplayUtils.js';
import { detailValueRow, formatCnAmount, formatCnMoney, formatFinancialCompact } from './marketFinancialFormatters.js';
function firstPairValue(value) {
  return Array.isArray(value) ? value[0] : value;
}
function getXueqiuPayload(fundData, key) {
  return fundData?.results?.[key]?.data || fundData?.results?.[key]?.raw?.data || null;
}
function getLatestFinanceRow(fundData, key) {
  const list = getXueqiuPayload(fundData, key)?.list;
  return Array.isArray(list) && list.length ? list[0] : null;
}

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
const FINANCIAL_AXIS_TICK = { fontSize: 11, fill: 'var(--market-text-muted)' };
const FINANCIAL_TOOLTIP_STYLE = { borderRadius: 10, borderColor: 'var(--market-border)', boxShadow: 'none' };
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
        <div className="h-8 w-64 animate-pulse rounded-lg bg-[var(--market-surface-muted)]" />
        <div className="h-52 animate-pulse rounded-xl bg-[var(--market-surface-muted)]" />
        <div className="h-36 animate-pulse rounded-xl bg-[var(--market-surface-muted)]" />
      </div>
    );
  }
  if (!rows.length) {
    return <div className="rounded-xl border border-[var(--market-border)] bg-[var(--market-surface-subtle)] px-4 py-6 text-sm text-[var(--market-text-muted)]">暂无财务报表数据。</div>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-full bg-[var(--market-surface-muted)] p-1">
          {FINANCIAL_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatement(tab.key)}
              className={cx('rounded-full px-3 py-1 text-[13px] font-medium transition', statement === tab.key ? 'bg-white text-[var(--market-text-strong)] shadow-[0_1px_2px_rgba(60,64,67,0.12)]' : 'text-[var(--market-text-muted)] hover:text-[var(--market-text-strong)]')}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-full border border-[var(--market-border-strong)] bg-white p-0.5">
          {FINANCIAL_PERIODS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setPeriod(tab.key)}
              className={cx('rounded-full px-3 py-1 text-[12px] font-medium transition', period === tab.key ? 'bg-[var(--market-accent-soft)] text-[var(--market-accent)]' : 'text-[var(--market-text-muted)] hover:bg-[var(--market-surface-muted)]')}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="h-56 rounded-xl border border-[var(--market-border)] bg-white p-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartRows} margin={FINANCIAL_CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--market-surface-muted)" vertical={false} />
            <XAxis dataKey="period" tick={FINANCIAL_AXIS_TICK} />
            <YAxis tickFormatter={formatFinancialCompact} tick={FINANCIAL_AXIS_TICK} width={48} />
            <Tooltip formatter={(v, name) => [formatFinancialCompact(v), financialFieldLabel(name)]} contentStyle={FINANCIAL_TOOLTIP_STYLE} />
            {fields.slice(0, 3).map(([key], idx) => (
              <Bar key={key} dataKey={key} fill={['var(--market-accent)', 'var(--market-fall)', '#f9ab00'][idx % 3]} radius={[4, 4, 0, 0]} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto rounded-xl border border-[var(--market-border)] bg-white">
        <table className="min-w-[720px] w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--market-surface-subtle)] text-[12px] text-[var(--market-text-muted)]">
            <tr>
              <th className="sticky left-0 z-20 border-b border-[var(--market-border)] bg-[var(--market-surface-subtle)] px-3 py-2 text-left font-medium">指标</th>
              {rows.map((row) => <th key={row.period} className="border-b border-[var(--market-border)] px-3 py-2 text-right font-medium tabular-nums">{row.period}</th>)}
            </tr>
          </thead>
          <tbody>
            {fields.map(([key, label]) => (
              <tr key={key} className="hover:bg-[var(--market-surface-subtle)]">
                <td className="sticky left-0 border-b border-[var(--market-surface-muted)] bg-white px-3 py-2 font-medium text-[var(--market-text-strong)]">{label}</td>
                {rows.map((row) => <td key={row.period} className="border-b border-[var(--market-surface-muted)] px-3 py-2 text-right tabular-nums text-[var(--market-text-strong)]">{formatFinancialCompact(financialValue(row, key))}</td>)}
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
      <div className="mt-3 rounded-xl border border-[var(--market-border)] bg-[var(--market-surface-subtle)] p-3 text-sm text-[var(--market-text-muted)]">
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
    <div className="mt-3 rounded-xl border border-[var(--market-border)] bg-[var(--market-surface-subtle)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-medium text-[var(--market-text-muted)]">上一工作日净值</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--market-text-strong)]">{formatNumber(data.baseNav, 4)}</div>
          {data.navDate ? <div className="mt-1 text-xs text-[var(--market-text-subtle)]">确认日期 {data.navDate}</div> : null}
        </div>
        <div className="text-right text-[12px] leading-5 text-[var(--market-text-muted)]">
          <div>场内价格 <span className="font-medium tabular-nums text-[var(--market-text-strong)]">{formatNumber(data.price, 4)}</span></div>
          <div>最新 IOPV <span className="font-medium tabular-nums text-[var(--market-text-strong)]">{formatNumber(data.iopv, 4)}</span></div>
          <div>最新溢价 <span className={cx('font-medium tabular-nums', Number(data.premiumPercent) > 0 ? 'text-[var(--market-rise)]' : Number(data.premiumPercent) < 0 ? 'text-[var(--market-fall)]' : 'text-[var(--market-text-strong)]')}>{formatSignedPercent(data.premiumPercent)}</span></div>
        </div>
      </div>
      <p className="mt-2 text-xs leading-4 text-[var(--market-text-subtle)]">净值取基金最新确认 NAV，场内基金盘中交易仍以价格为准。</p>
    </div>
  );
}


export function CnFundFlowPanel({ fundData, loading }) {
  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-[var(--market-surface-muted)]" />;
  const flow = getXueqiuPayload(fundData, 'capital_flow');
  const history = getXueqiuPayload(fundData, 'capital_history');
  const pankou = getXueqiuPayload(fundData, 'pankou');
  const latestFlow = Array.isArray(flow?.items) && flow.items.length ? flow.items[flow.items.length - 1] : null;
  const bidAskRows = [1, 2, 3, 4, 5].map((level) => ({
    level,
    bidPrice: pankou?.[`bp${level}`],
    bidVolume: pankou?.[`bc${level}`],
    askPrice: pankou?.[`sp${level}`],
    askVolume: pankou?.[`sc${level}`]
  }));
  if (!flow && !history && !pankou) return <div className="rounded-xl border border-[var(--market-border)] bg-[var(--market-surface-subtle)] px-4 py-6 text-sm text-[var(--market-text-muted)]">暂无资金和盘口数据。</div>;
  return (
    <div className="space-y-5">
      <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-between border-b border-[var(--market-border)] py-2"><span className="text-[var(--market-text-muted)]">最新资金流</span><span className="font-medium tabular-nums text-[var(--market-text-strong)]">{formatCnMoney(latestFlow?.amount)}</span></div>
        <div className="flex items-center justify-between border-b border-[var(--market-border)] py-2"><span className="text-[var(--market-text-muted)]">3日净流入</span><span className="font-medium tabular-nums text-[var(--market-text-strong)]">{formatCnMoney(history?.sum3)}</span></div>
        <div className="flex items-center justify-between border-b border-[var(--market-border)] py-2"><span className="text-[var(--market-text-muted)]">5日净流入</span><span className="font-medium tabular-nums text-[var(--market-text-strong)]">{formatCnMoney(history?.sum5)}</span></div>
        <div className="flex items-center justify-between border-b border-[var(--market-border)] py-2"><span className="text-[var(--market-text-muted)]">20日净流入</span><span className="font-medium tabular-nums text-[var(--market-text-strong)]">{formatCnMoney(history?.sum20)}</span></div>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--market-border)] bg-white">
        <div className="border-b border-[var(--market-border)] bg-[var(--market-surface-subtle)] px-3 py-2 text-sm font-semibold text-[var(--market-text-strong)]">盘口</div>
        <div className="grid grid-cols-5 gap-0 text-right text-[12px] sm:text-sm">
          <div className="px-2 py-2 text-left font-medium text-[var(--market-text-muted)]">档位</div><div className="px-2 py-2 font-medium text-[var(--market-text-muted)]">买价</div><div className="px-2 py-2 font-medium text-[var(--market-text-muted)]">买量</div><div className="px-2 py-2 font-medium text-[var(--market-text-muted)]">卖价</div><div className="px-2 py-2 font-medium text-[var(--market-text-muted)]">卖量</div>
          {bidAskRows.map((it) => (
            <div key={it.level} className="contents">
              <div className="border-t border-[var(--market-surface-muted)] px-2 py-2 text-left text-[var(--market-text-muted)]">{it.level}档</div>
              <div className="border-t border-[var(--market-surface-muted)] px-2 py-2 tabular-nums text-[var(--market-text-strong)]">{formatNumber(it.bidPrice, 3)}</div>
              <div className="border-t border-[var(--market-surface-muted)] px-2 py-2 tabular-nums text-[var(--market-text-strong)]">{formatCnAmount(it.bidVolume)}</div>
              <div className="border-t border-[var(--market-surface-muted)] px-2 py-2 tabular-nums text-[var(--market-text-strong)]">{formatNumber(it.askPrice, 3)}</div>
              <div className="border-t border-[var(--market-surface-muted)] px-2 py-2 tabular-nums text-[var(--market-text-strong)]">{formatCnAmount(it.askVolume)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CnFundReportPanel({ fundData, loading }) {
  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-[var(--market-surface-muted)]" />;
  const indicator = getLatestFinanceRow(fundData, 'finance_indicator');
  const balance = getLatestFinanceRow(fundData, 'finance_balance');
  const income = getLatestFinanceRow(fundData, 'finance_income');
  const cashflow = getLatestFinanceRow(fundData, 'finance_cash_flow');
  const reportName = indicator?.report_name || balance?.report_name || income?.report_name || cashflow?.report_name || '';
  const rows = [
    detailValueRow('报告期', reportName || MARKET_EMPTY_VALUE),
    detailValueRow('总资产', formatCnMoney(firstPairValue(balance?.total_assets))),
    detailValueRow('总负债', formatCnMoney(firstPairValue(balance?.total_liab))),
    detailValueRow('资产负债率', Number.isFinite(Number(firstPairValue(indicator?.asset_liab_ratio))) ? `${formatNumber(firstPairValue(indicator?.asset_liab_ratio), 2)}%` : MARKET_EMPTY_VALUE),
    detailValueRow('营收', formatCnMoney(firstPairValue(income?.revenue))),
    detailValueRow('营收同比', Number.isFinite(Number(firstPairValue(indicator?.operating_income_yoy))) ? `${formatNumber(firstPairValue(indicator?.operating_income_yoy), 2)}%` : MARKET_EMPTY_VALUE),
    detailValueRow('净利润', formatCnMoney(firstPairValue(income?.net_profit))),
    detailValueRow('综合收益', formatCnMoney(firstPairValue(income?.total_compre_income))),
    detailValueRow('经营现金流', formatCnMoney(firstPairValue(cashflow?.ncf_from_oa))),
    detailValueRow('总资本周转', formatNumber(firstPairValue(indicator?.total_capital_turnover), 4)),
  ];
  if (!indicator && !balance && !income && !cashflow) return <div className="rounded-xl border border-[var(--market-border)] bg-[var(--market-surface-subtle)] px-4 py-6 text-sm text-[var(--market-text-muted)]">暂无基金年报数据。</div>;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--market-border)] bg-[var(--market-surface-subtle)] px-3 py-2 text-[12px] text-[var(--market-text-muted)]">雪球返回的是基金年报口径数据，不是普通股票财报。</div>
      <div className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {rows.map((item) => (
          <div key={item.label} className="flex items-center justify-between border-b border-[var(--market-border)] py-2">
            <span className="text-[var(--market-text-muted)]">{item.label}</span>
            <span className="font-medium tabular-nums text-[var(--market-text-strong)]">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
