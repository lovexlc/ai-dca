// useCumulativeSparkline.js · v6.8 双卡 hero sparkline 数据源
//
// 轻量 hook：inception → today 的累计收益日级序列，供 IncomeSummary 左大卡 sparkline 使用。
// 复用 fetchNavHistory + buildPortfolioSeries 数据契约，与 IncomeDetailPage 一致。
//
// 输入：
//   - transactions: ledger.transactions
//   - inceptionDate: ISO YYYY-MM-DD，首笔 BUY 日
//
// 输出：number[]（日级 pnl）或 null（数据不足 / 恢复中）
//
// 失败不报错，sparkline 静默不渲染即可。

import { useEffect, useState } from 'react';
import { fetchNavHistory } from '../navHistoryClient.js';
import { buildPortfolioSeries } from '../portfolioSeries.js';

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
	const [series, setSeries] = useState(null);

	useEffect(() => {
		if (!inceptionDate || !Array.isArray(transactions) || transactions.length === 0) {
			setSeries(null);
			return undefined;
		}
		const today = todayShanghaiIso();
		if (inceptionDate > today) {
			setSeries(null);
			return undefined;
		}
		let cancelled = false;
		(async () => {
			try {
				const codes = uniqCodes(transactions);
				if (codes.length === 0) {
					if (!cancelled) setSeries(null);
					return;
				}
				const navByCode = {};
				await Promise.all(
					codes.map(async (code) => {
						try {
							const res = await fetchNavHistory({ code, from: inceptionDate, to: today });
							navByCode[code] = res?.items || [];
						} catch {
							navByCode[code] = [];
						}
					}),
				);
				const result = buildPortfolioSeries({
					tx: transactions,
					navByCode,
					from: inceptionDate,
					to: today,
				});
				const daily = Array.isArray(result?.dailySeries) ? result.dailySeries : [];
				const pnls = daily
					.map((d) => (Number.isFinite(d?.pnl) ? d.pnl : null))
					.filter((v) => v !== null);
				if (!cancelled) setSeries(pnls.length >= 2 ? pnls : null);
			} catch {
				if (!cancelled) setSeries(null);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [transactions, inceptionDate]);

	return series;
}

export default useCumulativeSparkline;
