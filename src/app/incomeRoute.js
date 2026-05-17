// incomeRoute.js
//
// 收益看板 v2 的 hash route 工具 (零依赖)。
//
// - URL 格式: `#/income` `#/chart` `#/calendar` `#/liquidation` `#/breakdown` `#/transactions`
// - 空 hash (或 "#" / "#/") = OVERVIEW (主页)
// - 未知片段 → fallback OVERVIEW，不抹除 URL (避免干扰别人的错 hash)
// - 使用 hash change 事件订阅，与项目已有的 useRangeUrlSync 互不干扰
//   (range 走 query、route 走 hash)

import { useCallback, useEffect, useState } from 'react';

export const ROUTES = Object.freeze({
	OVERVIEW: '',
	INCOME: 'income',
	CHART: 'chart',
	CALENDAR: 'calendar',
	LIQUIDATION: 'liquidation',
	BREAKDOWN: 'breakdown',
	TRANSACTIONS: 'transactions',
});

const VALID_ROUTES = new Set(Object.values(ROUTES));

export function parseHashRoute(hash) {
	if (!hash || typeof hash !== 'string') return ROUTES.OVERVIEW;
	const trimmed = hash.replace(/^#\/?/, '').trim();
	if (!trimmed) return ROUTES.OVERVIEW;
	const seg = trimmed.split(/[/?#]/)[0] || '';
	return VALID_ROUTES.has(seg) ? seg : ROUTES.OVERVIEW;
}

function currentHash() {
	if (typeof window === 'undefined') return '';
	return window.location.hash || '';
}

export function setHashRoute(next) {
	if (typeof window === 'undefined') return;
	const target = next || ROUTES.OVERVIEW;
	if (target === ROUTES.OVERVIEW) {
		// 清空 hash，但保留 path + query
		const url = window.location.pathname + window.location.search;
		window.history.pushState(null, '', url);
		// pushState 不会触发 hashchange，手动发一个
		window.dispatchEvent(new HashChangeEvent('hashchange'));
		return;
	}
	const nextHash = `#/${target}`;
	if (currentHash() === nextHash) return;
	window.location.hash = nextHash;
}

export function useIncomeRoute() {
	const [route, setRoute] = useState(() => parseHashRoute(currentHash()));

	useEffect(() => {
		if (typeof window === 'undefined') return undefined;
		const handler = () => setRoute(parseHashRoute(currentHash()));
		window.addEventListener('hashchange', handler);
		return () => window.removeEventListener('hashchange', handler);
	}, []);

	const navigate = useCallback((next) => {
		setHashRoute(next || ROUTES.OVERVIEW);
	}, []);

	const goBack = useCallback(() => {
		if (typeof window === 'undefined') return;
		// 如果这个页面不是从主页跳过来的（直接粘贴 url），history 可能只有1 条，走 fallback
		if (window.history.length > 1) {
			window.history.back();
		} else {
			setHashRoute(ROUTES.OVERVIEW);
		}
	}, []);

	return { route, navigate, goBack };
}
