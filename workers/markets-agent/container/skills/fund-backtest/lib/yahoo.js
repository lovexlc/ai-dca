// Yahoo Chart fetcher. Returns ascending-by-date array of { date, close }.
// Uses adjclose (split + dividend adjusted) when available, falls back to raw close.

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';

export async function fetchYahoo(symbol, range, interval) {
	const q = '?range=' + encodeURIComponent(range)
		+ '&interval=' + encodeURIComponent(interval)
		+ '&includePrePost=false&events=div%2Csplit';
	const url = YAHOO_BASE + encodeURIComponent(symbol) + q;
	const r = await fetch(url, {
		headers: {
			'user-agent': 'Mozilla/5.0 (markets-agent fund-backtest skill)',
			accept: 'application/json',
		},
	});
	if (!r.ok) throw new Error('yahoo_http_' + r.status);
	const j = await r.json();
	const result = j && j.chart && Array.isArray(j.chart.result) ? j.chart.result[0] : null;
	if (!result) {
		const errDesc = j && j.chart && j.chart.error ? (j.chart.error.description || j.chart.error.code) : null;
		throw new Error('yahoo_no_result' + (errDesc ? '_' + errDesc : ''));
	}
	const ts = result.timestamp;
	const adj = result.indicators && result.indicators.adjclose && result.indicators.adjclose[0]
		? result.indicators.adjclose[0].adjclose : null;
	const raw = result.indicators && result.indicators.quote && result.indicators.quote[0]
		? result.indicators.quote[0].close : null;
	if (!Array.isArray(ts)) throw new Error('yahoo_no_timestamps');
	const closes = Array.isArray(adj) ? adj : raw;
	if (!Array.isArray(closes)) throw new Error('yahoo_no_closes');
	const out = [];
	for (let i = 0; i < ts.length; i++) {
		const c = closes[i];
		if (c == null || !isFinite(c)) continue;
		const d = new Date(ts[i] * 1000);
		const date = d.toISOString().slice(0, 10);
		out.push({ date, close: Number(c) });
	}
	return out;
}
