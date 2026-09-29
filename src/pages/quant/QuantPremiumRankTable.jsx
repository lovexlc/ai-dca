// 6 只纳指ETF 溢价排名表：按溢价率升序，持仓行高亮并标注持有盘。
import { cx } from '../../components/experience-ui.jsx';
import { formatPct, formatShares, portfolioColor, premiumClass } from './quantFormat.js';

function formatLevel(level) {
  if (!level) return '—';
  const price = Number(level[0]);
  const shares = Number(level[1]);
  return `${Number.isFinite(price) ? price.toFixed(3) : '—'} · ${formatShares(shares)}`;
}

export function QuantPremiumRankTable({ quotes, symbols, symbolNames, holdingsBySymbol, specs }) {
  const specIndexByKey = new Map((specs || []).map((spec, index) => [spec.key, index]));
  const rows = (symbols || []).map((code) => {
    const quote = quotes[code] || {};
    const premium = Number(quote.premium);
    return {
      code,
      name: symbolNames[code] || '',
      price: Number(quote.price),
      premium: Number.isFinite(premium) ? premium : null,
      bid: (quote.bids || [])[0],
      ask: (quote.asks || [])[0],
      holders: holdingsBySymbol[code] || []
    };
  });
  rows.sort((a, b) => (a.premium ?? Infinity) - (b.premium ?? Infinity));
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-700">纳指100ETF 溢价排名</h2>
        <span className="text-xs text-slate-400">按溢价率升序 · 持仓行高亮</span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-100">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">标的 / 代码</th>
              <th className="px-3 py-2 text-right">现价</th>
              <th className="px-3 py-2 text-right">溢价率</th>
              <th className="px-3 py-2 text-right">买一（价 · 量）</th>
              <th className="px-3 py-2 text-right">卖一（价 · 量）</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length ? (
              rows.map((row, idx) => {
                const held = row.holders.length > 0;
                return (
                  <tr key={row.code} className={cx(held ? 'bg-indigo-50/70' : 'bg-white')}>
                    <td className="px-3 py-2 tabular-nums text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-800">{row.name || '—'}</span>
                        <span className="text-xs tabular-nums text-slate-400">{row.code}</span>
                        {row.holders.map((spec) => (
                          <span
                            key={spec.key}
                            className="rounded-md px-1.5 py-0.5 text-xs font-semibold text-white"
                            style={{
                              backgroundColor: portfolioColor(specIndexByKey.get(spec.key) ?? 0)
                            }}
                          >
                            {spec.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {Number.isFinite(row.price) ? row.price.toFixed(3) : '—'}
                    </td>
                    <td
                      className={cx('px-3 py-2 text-right font-bold tabular-nums', premiumClass(row.premium))}
                    >
                      {row.premium == null ? '—' : formatPct(row.premium, 4)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-600">
                      {formatLevel(row.bid)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-600">
                      {formatLevel(row.ask)}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  暂无行情数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
