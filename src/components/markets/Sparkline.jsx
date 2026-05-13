import React, { useMemo } from 'react';

// 纯 SVG 迷你走势图，不依赖外部库。
// points: number[]，时间序列（从旧到新）。
// tone: 'auto' | 'up' | 'down' | 'flat'。auto 时按首末值决定。
export function Sparkline({
  points,
  width = 96,
  height = 28,
  strokeWidth = 1.5,
  tone = 'auto',
  showFill = true,
  className = ''
}) {
  const data = useMemo(
    () => (Array.isArray(points) ? points.filter((v) => Number.isFinite(Number(v))).map(Number) : []),
    [points]
  );

  if (data.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={className}
        aria-hidden="true"
      >
        <line
          x1="2"
          y1={height / 2}
          x2={width - 2}
          y2={height / 2}
          stroke="#cbd5e1"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  let resolvedTone = tone;
  if (tone === 'auto') {
    const first = data[0];
    const last = data[data.length - 1];
    if (last > first) resolvedTone = 'up';
    else if (last < first) resolvedTone = 'down';
    else resolvedTone = 'flat';
  }

  const colorMap = {
    up: { stroke: '#10b981', fill: 'rgba(16,185,129,0.18)' },
    down: { stroke: '#f43f5e', fill: 'rgba(244,63,94,0.16)' },
    flat: { stroke: '#94a3b8', fill: 'rgba(148,163,184,0.16)' }
  };
  const { stroke, fill } = colorMap[resolvedTone] || colorMap.flat;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padX = 2;
  const padY = 2;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const stepX = innerW / (data.length - 1);

  const coords = data.map((v, i) => {
    const x = padX + i * stepX;
    const y = padY + innerH - ((v - min) / range) * innerH;
    return [x, y];
  });

  const linePath = coords
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');

  const fillPath = showFill
    ? `${linePath} L${coords[coords.length - 1][0].toFixed(2)},${(padY + innerH).toFixed(2)} L${coords[0][0].toFixed(2)},${(padY + innerH).toFixed(2)} Z`
    : null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {fillPath ? <path d={fillPath} fill={fill} stroke="none" /> : null}
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default Sparkline;
