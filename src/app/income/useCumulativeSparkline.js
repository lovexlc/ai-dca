// useCumulativeSparkline.js · v6.8 双卡 hero sparkline 数据源
//
// 轻量 hook：inception → today 的累计收益日级序列，供 IncomeSummary 左大卡 sparkline 使用。
// 复用 fetchNavHistoryBatch + buildPortfolioSeries 数据契约，与 IncomeDetailPage 一致。
//
// 输入：
//   - transactions: ledger.transactions
//   - inceptionDate: ISO YYYY-MM-DD，首笔 BUY 日
//
// 输出：{ series: number[], lastIso: string, profit: number, returnRate: number, returnRatePct: number } 或 null（数据不足 / 恢复中）
// - series：日级 pnl（同之前发出到 IncomeSummary 的数组）
// - lastIso：series 末端点对应的单位净值公布日（指示 UI 不包含今日实时估算）
//
// 失败不报错，sparkline 静默不渲染即可。

import { useEffect, useState } from 'react';
import { fetchNavHistoryBatch } from '../navHistoryClient.js';
import { buildPortfolioSeries, shiftDays } from '../portfolioSeries.js';

function todayShanghaiIso() {
	const now = new Date();
	const offsetMin = now.getTimezoneOffset();
	const shanghaiOffsetMin = -480;
	const delta = (offsetMin - shanghaiOffsetMin) * 60 * 1000;
	const shanghai = new Date(now.getTime() - delta);
	const yyyy = shanghai.getUTCFullYear();
	const mm = String(shanghai.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(shanghai.getUTCDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

function uniqCodes(txs) {
	const set = new Set();
	for (const tx of txs || []) {
		if (tx?.code) set.add(String(tx.code).trim());
	}
	return Array.from(set).filter(Boolean);
}

export function useCumulativeSparkline({ transactions, inceptionDate }) {
	const [snapshot, setSnapshot] = useState(null);

	useEffect(() => {
		if (!inceptionDate || !Array.isArray(transactions) || transactions.length === 0) {
			setSnapshot(null);
			return undefined;
		}
		const today = todayShanghaiIso();
		if (inceptionDate > today) {
			setSnapshot(null);
			return undefined;
		}
		let cancelled = false;
		(async () => {
			try {
				const codes = uniqCodes(transactions);
				if (codes.length === 0) {
					if (!cancelled) setSnapshot(null);
					return;
				}
				const navResult = await fetchNavHistoryBatch({
					codes,
					from: shiftDays(inceptionDate, -30),
					to: today,
				});
				const result = buildPortfolioSeries({
					tx: transactions,
					navByCode: navResult?.navByCode || {},
					from: inceptionDate,
					to: today,
				});
				const daily = Array.isArray(result?.dailySeries) ? result.dailySeries : [];
				const validDaily = daily.filter((d) => Number.isFinite(d?.pnl));
				const pnls = validDaily.map((d) => d.pnl);
				const lastIso = validDaily.length > 0 ? String(validDaily[validDaily.length - 1]?.date || '') : '';
				const profit = Number.isFinite(result?.windowProfit) ? result.windowProfit : null;
				const returnRate = Number.isFinite(result?.twrReturnRate) ? result.twrReturnRate : null;
				if (!cancelled) {
					setSnapshot({
						series: pnls,
						lastIso,
						profit,
						returnRate,
						returnRatePct: returnRate == null ? null : returnRate * 100,
						stale: !!navResult?.stale,
					});
				}
			} catch {
				if (!cancelled) setSnapshot(null);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [transactions, inceptionDate]);

	return snapshot;
}

export default useCumulativeSparkline;
