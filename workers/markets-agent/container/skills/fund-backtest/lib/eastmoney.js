// A-share OTC fund historical unit NAV (DWJZ).
// Reuse the shared history loader first and keep a direct Eastmoney fallback
// for transient upstream failures.

import { fetchFundNavHistory } from '../../../../../notify/src/getNav.js';

const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const RETRY_DELAYS_MS = [250, 750, 1500];
const RETRYABLE_ERROR = /\b(?:HTTP\s+(?:429|500|502|503|504)|fetch failed|network)\b/i;
const REQUEST_HEADERS = {
	accept: 'application/json, text/plain, */*',
	referer: 'https://fundf10.eastmoney.com/',
	'user-agent': 'Mozilla/5.0 (compatible; ai-dca/1.0)',
};

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

function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}

function normalizeDate(value) {
	const text = String(value || '').trim();
	return text.length >= 10 ? text.slice(0, 10) : '';
}

function normalizeNavItems(items, startStr, endStr) {
	const byDate = new Map();
	for (const item of Array.isArray(items) ? items : []) {
		const date = normalizeDate(item?.date ?? item?.FSRQ);
		const close = Number(item?.nav ?? item?.DWJZ ?? item?.close);
		if (
			!/^\d{4}-\d{2}-\d{2}$/.test(date)
			|| date < startStr
			|| date > endStr
			|| !Number.isFinite(close)
			|| close <= 0
		) {
			continue;
		}
		byDate.set(date, { date, close });
	}
	return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function shouldRetry(error) {
	return RETRYABLE_ERROR.test(errorText(error));
}

async function withRetry(label, task) {
	let lastError;
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
		try {
			return await task();
		} catch (error) {
			lastError = error;
			if (attempt === RETRY_DELAYS_MS.length || !shouldRetry(error)) break;
			await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
		}
	}
	throw new Error(label + ': ' + errorText(lastError));
}

function parseJsonLike(text) {
	const trimmed = String(text || '').trim();
	const candidates = [
		trimmed,
		trimmed.replace(/^var\s+\w+\s*=\s*/, '').replace(/;\s*$/, ''),
	];
	for (const candidate of candidates) {
		if (!candidate) continue;
		try {
			return JSON.parse(candidate);
		} catch {
			// Try the next response shape.
		}
	}
	throw new Error('non-JSON response');
}

async function fetchJson(url) {
	const response = await fetch(url, { headers: REQUEST_HEADERS });
	if (!response.ok) throw new Error('HTTP ' + response.status);
	return parseJsonLike(await response.text());
}

function extractEastmoneyRows(payload) {
	const candidates = [
		payload?.Data?.LSJZList,
		payload?.data?.LSJZList,
		payload?.Data?.items,
		payload?.data?.items,
	];
	return candidates.find(Array.isArray) || [];
}

function buildEastmoneyUrl(code, page, dates, endpoint) {
	const encodedCode = encodeURIComponent(code);
	if (endpoint === 'f10') {
		return 'https://fundf10.eastmoney.com/F10DataApi.aspx?type=lsjz'
			+ '&code=' + encodedCode
			+ '&page=' + page
			+ '&per=' + PAGE_SIZE
			+ '&sdate=' + dates.startStr
			+ '&edate=' + dates.endStr;
	}
	return 'https://api.fund.eastmoney.com/f10/lsjz?fundCode='
		+ encodedCode
		+ '&pageIndex=' + page
		+ '&pageSize=' + PAGE_SIZE;
}

async function fetchEastmoneyEndpoint(code, dates, endpoint) {
	const rawRows = [];
	let previousOldestDate = '';
	for (let page = 1; page <= MAX_PAGES; page += 1) {
		const url = buildEastmoneyUrl(code, page, dates, endpoint);
		const payload = await withRetry(
			'Eastmoney ' + endpoint + ' page ' + page,
			() => fetchJson(url),
		);
		const pageRows = extractEastmoneyRows(payload);
		if (!pageRows.length) break;
		rawRows.push(...pageRows);

		const pageDates = pageRows
			.map((item) => normalizeDate(item?.FSRQ ?? item?.date))
			.filter(Boolean)
			.sort();
		const oldestDate = pageDates[0] || '';
		if (oldestDate && oldestDate === previousOldestDate) break;
		previousOldestDate = oldestDate;
		if (oldestDate && oldestDate <= dates.startStr) break;
	}
	return normalizeNavItems(rawRows, dates.startStr, dates.endStr);
}

async function fetchDirectEastmoneyFund(code, dates) {
	let lastError = new Error('empty data');
	for (const endpoint of ['api', 'f10']) {
		try {
			const items = await fetchEastmoneyEndpoint(code, dates, endpoint);
			if (items.length) return items;
			lastError = new Error(endpoint + ': empty data');
		} catch (error) {
			lastError = error;
		}
	}
	throw new Error('direct fallback failed: ' + errorText(lastError));
}

export async function fetchEastmoneyFund(code, range) {
	const dates = rangeStartDate(range);
	let primaryError;
	try {
		const items = await withRetry(
			'shared NAV reference',
			() => fetchFundNavHistory(code, dates.startStr, dates.endStr),
		);
		const normalized = normalizeNavItems(items, dates.startStr, dates.endStr);
		if (normalized.length) return normalized;
		primaryError = new Error('shared NAV reference returned no rows');
	} catch (error) {
		primaryError = error;
	}

	try {
		return await fetchDirectEastmoneyFund(code, dates);
	} catch (fallbackError) {
		throw new Error(
			'Eastmoney reference failed: shared=' + errorText(primaryError)
			+ '; eastmoney=' + errorText(fallbackError),
		);
	}
}
