// A-share OTC fund historical unit NAV (DWJZ).
// 统一复用 getNav 的历史净值方法。

import { fetchFundNavHistory } from '../../../../../notify/src/getNav.js';

function rangeStartDate(range) {
	const end = new Date();
	const start = new Date(end);
	switch (range) {
		case '1mo': start.setMonth(start.getMonth() - 1); break;
		case '3mo': start.setMonth(start.getMonth() - 3); break;
		case '6mo': start.setMonth(start.getMonth() - 6); break;
		case 'ytd': start.setMonth(0); start.setDate(1); break;
		case '2y': start.setFullYear(start.getFullYear() - 2); break;
		case '5y': start.setFullYear(start.getFullYear() - 5); break;
		case 'max': start.setFullYear(2000, 0, 1); break;
		case '1y':
		default: start.setFullYear(start.getFullYear() - 1); break;
	}
	const pad = (n) => String(n).padStart(2, '0');
	const fmt = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
	return { startStr: fmt(start), endStr: fmt(end) };
}

export async function fetchEastmoneyFund(code, range) {
	const dates = rangeStartDate(range);
	const items = await fetchFundNavHistory(code, dates.startStr, dates.endStr);
	return (Array.isArray(items) ? items : [])
		.filter((item) => item && item.date)
		.map((item) => ({ date: item.date, close: item.nav }));
}
