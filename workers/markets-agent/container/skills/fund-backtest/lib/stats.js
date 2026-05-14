// Stats: cum_return, ann_return, vol, max_dd, sharpe per series; pairwise Pearson correlation.

const ANNUALIZATION = { '1d': 252, '1wk': 52, '1mo': 12 };

function periodsPerYear(interval) {
	return ANNUALIZATION[interval] || 252;
}

export function computeStats(closes, interval) {
	if (!Array.isArray(closes) || closes.length < 2) {
		return { cum_return: 0, ann_return: 0, vol: 0, max_dd: 0, sharpe: 0 };
	}
	const N = closes.length;
	const first = closes[0];
	const last = closes[N - 1];
	const cum_return = last / first - 1;

	const rets = [];
	for (let i = 1; i < N; i++) rets.push(closes[i] / closes[i - 1] - 1);

	const ppy = periodsPerYear(interval);
	const ann_return = Math.pow(1 + cum_return, ppy / (N - 1)) - 1;

	const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
	const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(rets.length - 1, 1);
	const stdev = Math.sqrt(variance);
	const vol = stdev * Math.sqrt(ppy);

	const sharpe = vol > 0 ? ann_return / vol : 0;

	let peak = closes[0];
	let maxDd = 0;
	for (const c of closes) {
		if (c > peak) peak = c;
		const dd = c / peak - 1;
		if (dd < maxDd) maxDd = dd;
	}

	const round = (x, p) => Math.round(x * 10 ** p) / 10 ** p;
	return {
		cum_return: round(cum_return, 4),
		ann_return: round(ann_return, 4),
		vol: round(vol, 4),
		max_dd: round(maxDd, 4),
		sharpe: round(sharpe, 3),
	};
}

export function correlationMatrix(aligned) {
	const syms = Object.keys(aligned);
	const out = {};
	const retsBySym = {};
	for (const s of syms) {
		const c = aligned[s];
		const r = [];
		for (let i = 1; i < c.length; i++) r.push(c[i] / c[i - 1] - 1);
		retsBySym[s] = r;
	}
	for (let i = 0; i < syms.length; i++) {
		for (let j = i + 1; j < syms.length; j++) {
			const a = retsBySym[syms[i]];
			const b = retsBySym[syms[j]];
			const n = Math.min(a.length, b.length);
			if (n < 2) { out[`${syms[i]}-${syms[j]}`] = 0; continue; }
			const meanA = a.slice(0, n).reduce((s, x) => s + x, 0) / n;
			const meanB = b.slice(0, n).reduce((s, x) => s + x, 0) / n;
			let cov = 0, varA = 0, varB = 0;
			for (let k = 0; k < n; k++) {
				const da = a[k] - meanA, db = b[k] - meanB;
				cov += da * db;
				varA += da * da;
				varB += db * db;
			}
			const denom = Math.sqrt(varA * varB);
			const rr = denom > 0 ? cov / denom : 0;
			out[`${syms[i]}-${syms[j]}`] = Math.round(rr * 1000) / 1000;
		}
	}
	return out;
}
