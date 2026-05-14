#!/usr/bin/env node
// fund-backtest skill entry. Reads JSON args from stdin, emits JSON result to stdout.
// Domain errors -> exit 0 with { ok: false, error }. Only crash on infrastructure faults.

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchYahoo } from '../lib/yahoo.js';
import { fetchEastmoneyFund } from '../lib/eastmoney.js';
import { computeStats, correlationMatrix } from '../lib/stats.js';
import { renderNAVChart } from '../lib/chart.js';

function readStdin() {
	return new Promise((resolve, reject) => {
		let buf = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (chunk) => { buf += chunk; });
		process.stdin.on('end', () => resolve(buf));
		process.stdin.on('error', reject);
	});
}

function isChinaFundCode(s) {
	return /^\d{6}$/.test(String(s).trim());
}

function alignSeries(seriesBySym) {
	const symbols = Object.keys(seriesBySym);
	if (!symbols.length) return { dates: [], aligned: {} };
	const dateSets = symbols.map((s) => new Set(seriesBySym[s].map((c) => c.date)));
	const commonDates = [...dateSets[0]].filter((d) => dateSets.every((set) => set.has(d))).sort();
	const aligned = {};
	for (const sym of symbols) {
		const m = new Map(seriesBySym[sym].map((c) => [c.date, c.close]));
		aligned[sym] = commonDates.map((d) => m.get(d));
	}
	return { dates: commonDates, aligned };
}

async function fetchOne(symbol, range, interval) {
	if (isChinaFundCode(symbol)) {
		return await fetchEastmoneyFund(symbol, range);
	}
	return await fetchYahoo(symbol, range, interval);
}

async function main() {
	const raw = await readStdin();
	let args;
	try { args = JSON.parse(raw || '{}'); } catch { args = {}; }

	const symbols = (Array.isArray(args.symbols) ? args.symbols : [])
		.map((s) => String(s).trim())
		.filter(Boolean)
		.map((s) => isChinaFundCode(s) ? s : s.toUpperCase())
		.slice(0, 5);
	if (!symbols.length) return { ok: false, error: 'symbols_required' };

	const range = args.range || '1y';
	const interval = args.interval || '1d';
	const benchmark = args.benchmark ? String(args.benchmark).trim() : null;
	const benchNorm = benchmark ? (isChinaFundCode(benchmark) ? benchmark : benchmark.toUpperCase()) : null;
	const allSyms = benchNorm && !symbols.includes(benchNorm) ? [...symbols, benchNorm] : symbols;

	const seriesBySym = {};
	const errors = {};
	await Promise.all(allSyms.map(async (sym) => {
		try {
			const candles = await fetchOne(sym, range, interval);
			if (!candles || !candles.length) errors[sym] = 'no_data';
			else seriesBySym[sym] = candles;
		} catch (err) {
			errors[sym] = String(err?.message || err);
		}
	}));

	const okSyms = Object.keys(seriesBySym);
	if (!okSyms.length) return { ok: false, error: 'all_symbols_failed', detail: errors };

	const { dates, aligned } = alignSeries(seriesBySym);
	if (dates.length < 2) return { ok: false, error: 'insufficient_overlap', detail: { aligned_points: dates.length, per_symbol_points: Object.fromEntries(okSyms.map((s) => [s, seriesBySym[s].length])) } };

	const series = {};
	for (const sym of okSyms) series[sym] = computeStats(aligned[sym], interval);
	const corr = correlationMatrix(aligned);

	const primaryOk = symbols.filter((s) => series[s]);
	let winner = null, winnerRet = -Infinity;
	for (const s of primaryOk) {
		if (series[s].cum_return > winnerRet) { winnerRet = series[s].cum_return; winner = s; }
	}

	// Rebased-to-100 NAV series, suitable for client-side interactive charts.
	const rebased = {};
	for (const sym of okSyms) {
		const arr = aligned[sym];
		const base = arr[0];
		rebased[sym] = arr.map((v) => Number(((v / base) * 100).toFixed(4)));
	}

	const chartSvg = renderNAVChart(dates, aligned, { width: 720, height: 320 });
	const chartB64 = Buffer.from(chartSvg, 'utf8').toString('base64');

	const csvPath = join(tmpdir(), `backtest-${Date.now()}.csv`);
	const csvHeader = ['date', ...okSyms].join(',');
	const csvRows = dates.map((d, i) => [d, ...okSyms.map((s) => aligned[s][i])].join(','));
	writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'));

	return {
		ok: true,
		data: {
			window: { start: dates[0], end: dates[dates.length - 1], trading_points: dates.length, interval },
			series,
			correlation_matrix: corr,
			winner_by_total_return: winner,
			chart_data: { dates, rebased_to_100: rebased },
			chart_svg_b64: chartB64,
			raw_csv_path: csvPath,
			errors: Object.keys(errors).length ? errors : undefined,
		},
	};
}

main()
	.then((out) => { process.stdout.write(JSON.stringify(out)); process.exit(0); })
	.catch((err) => {
		process.stderr.write(`[fund-backtest fatal] ${err?.stack || err}\n`);
		process.stdout.write(JSON.stringify({ ok: false, error: 'skill_fatal', detail: String(err?.message || err) }));
		process.exit(0);
	});
