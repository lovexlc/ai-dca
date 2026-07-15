// Render NAV chart as SVG. Rebase all series to 100 at start. Returns plain SVG string.

const COLORS = ['#2563eb', '#dc2626', '#16a34a', '#ca8a04', '#9333ea', '#0891b2'];
// Keep standalone SVG output aligned with src/styles/tokens.css. CSS variables are
// unavailable when this chart is rendered outside the application document.
const SVG_FONT_FAMILY = [
	'system-ui', '-apple-system', 'BlinkMacSystemFont', "'Segoe UI'", 'Roboto',
	"'Helvetica Neue'", "'PingFang SC'", "'Hiragino Sans GB'", "'Noto Sans CJK SC'",
	"'Noto Sans SC'", "'Microsoft YaHei'", 'Arial', 'sans-serif',
].join(',');

function escapeXml(s) {
	return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pickTicks(min, max, count = 5) {
	const step = (max - min) / (count - 1);
	return Array.from({ length: count }, (_, i) => min + i * step);
}

function pickDateTicks(dates, count = 5) {
	if (dates.length <= count) return dates.slice();
	const step = (dates.length - 1) / (count - 1);
	return Array.from({ length: count }, (_, i) => dates[Math.round(i * step)]);
}

export function renderNAVChart(dates, alignedClose, opts = {}) {
	const W = opts.width || 720;
	const H = opts.height || 320;
	const M = { top: 30, right: 96, bottom: 36, left: 52 };
	const innerW = W - M.left - M.right;
	const innerH = H - M.top - M.bottom;

	const syms = Object.keys(alignedClose);
	const rebased = {};
	for (const s of syms) {
		const arr = alignedClose[s];
		const f = arr[0];
		rebased[s] = arr.map((v) => (v / f) * 100);
	}

	let yMin = Infinity, yMax = -Infinity;
	for (const s of syms) {
		for (const v of rebased[s]) {
			if (v < yMin) yMin = v;
			if (v > yMax) yMax = v;
		}
	}
	const pad = (yMax - yMin) * 0.08 || 1;
	yMin -= pad; yMax += pad;

	const N = dates.length;
	const xFor = (i) => M.left + (N > 1 ? (i / (N - 1)) * innerW : 0);
	const yFor = (v) => M.top + (1 - (v - yMin) / (yMax - yMin)) * innerH;

	const lines = syms.map((sym, idx) => {
		const color = COLORS[idx % COLORS.length];
		const pts = rebased[sym].map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
		const lastV = rebased[sym][rebased[sym].length - 1];
		const lastY = yFor(lastV);
		return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}" />
	<text x="${(M.left + innerW + 6).toFixed(1)}" y="${lastY.toFixed(1)}" fill="${color}" font-size="12" alignment-baseline="middle">${escapeXml(sym)} ${lastV.toFixed(1)}</text>`;
	}).join('\n');

	const yTicks = pickTicks(yMin, yMax, 5);
	const yAxis = yTicks.map((t) => {
		const y = yFor(t);
		return `<line x1="${M.left}" y1="${y.toFixed(1)}" x2="${M.left + innerW}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1" />
	<text x="${(M.left - 6).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="end" font-size="11" fill="#6b7280" alignment-baseline="middle">${t.toFixed(0)}</text>`;
	}).join('\n');

	const xTicks = pickDateTicks(dates, 5);
	const xAxis = xTicks.map((d) => {
		const i = dates.indexOf(d);
		const x = xFor(i);
		return `<text x="${x.toFixed(1)}" y="${(M.top + innerH + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="#6b7280">${escapeXml(d)}</text>`;
	}).join('\n');

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${SVG_FONT_FAMILY}">
<rect width="${W}" height="${H}" fill="#ffffff"/>
<text x="${M.left.toFixed(1)}" y="${(M.top - 10).toFixed(1)}" font-size="12" fill="#374151">NAV (rebased to 100)</text>
${yAxis}
${xAxis}
${lines}
</svg>`;
}
