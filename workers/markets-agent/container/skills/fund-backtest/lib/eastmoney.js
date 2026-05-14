// A-share OTC fund historical unit NAV (DWJZ).
// API: api.fund.eastmoney.com/f10/lsjz with Referer set to fundf10.eastmoney.com/jjjz_<code>.html.

const EM_API = 'https://api.fund.eastmoney.com/f10/lsjz';
const EM_REFERER_PREFIX = 'https://fundf10.eastmoney.com/jjjz_';

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
	const referer = EM_REFERER_PREFIX + encodeURIComponent(code) + '.html';
	const headers = {
		'user-agent': 'Mozilla/5.0 (markets-agent fund-backtest skill)',
		referer,
		accept: 'application/json, text/javascript, */*; q=0.01',
		'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
	};
	const all = [];
	const pageSize = 40;
	let pageIndex = 1;
	for (let p = 0; p < 50; p++) {
		const qs = '?fundCode=' + encodeURIComponent(code)
			+ '&pageIndex=' + pageIndex
			+ '&pageSize=' + pageSize
			+ '&startDate=' + encodeURIComponent(dates.startStr)
			+ '&endDate=' + encodeURIComponent(dates.endStr);
		const r = await fetch(EM_API + qs, { headers });
		if (!r.ok) throw new Error('eastmoney_http_' + r.status);
		const j = await r.json().catch(() => null);
		if (!j || j.ErrCode !== 0) {
			const msg = j ? String(j.ErrMsg || '').slice(0, 40) : '';
			throw new Error('eastmoney_err_' + (j && j.ErrCode) + '_' + msg);
		}
		const rows = (j.Data && j.Data.LSJZList) || [];
		for (const row of rows) {
			const close = parseFloat(row.DWJZ);
			if (!isFinite(close)) continue;
			all.push({ date: row.FSRQ, close });
		}
		const total = Number(j.TotalCount) || 0;
		if (pageIndex * pageSize >= total) break;
		if (!rows.length) break;
		pageIndex++;
	}
	all.sort((a, b) => a.date.localeCompare(b.date));
	return all;
}
