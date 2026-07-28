import historyCsv from '../../data/taco/taco-history-2026-07-28.csv?raw';

export const TACO_MODEL = {
  scoreScaleZ: 2.9,
  scoreFormula: 'clip(round(9.7727 + 0.611395 × Brent + 5.89306 × UST10Y - 0.00144492 × SP500 - 0.765978 × HormuzTotal), 0, 100)',
  compositeFormula: '0.283408 + 0.0177304 × Brent + 0.170899 × UST10Y - 0.0000419026 × SP500 - 0.0222134 × HormuzTotal',
  fit: {
    observations: 1698,
    rmse: 1.803,
    mae: 1.016,
    rSquared: 0.9936,
    withinThreeRate: 93
  },
  temporalValidation: {
    window: '2026-01-01 → 2026-02-27',
    rmse: 1.259,
    withinThreeRate: 98.3
  }
};

export const TACO_LATEST = {
  date: '2026-07-28',
  score: 81,
  status: '转向在即',
  percentile: '前 5%',
  rank: '第 92 高',
  source: 'CSV 历史快照',
  factors: [
    { key: 'brent', label: '布伦特原油', value: '$86.7', contribution: 17, tone: 'rose', direction: '偏高', note: '能源成本压力' },
    { key: 'ust10y', label: '美债 10Y', value: '4.64%', contribution: 4, tone: 'amber', direction: '正常', note: '融资压力' },
    { key: 'hormuz', label: '霍尔木兹通行', value: '4 艘/日', contribution: 83, tone: 'emerald', direction: '极低', note: '航运中断压力' },
    { key: 'sp500', label: '标普 500', value: '7,413', contribution: -3, tone: 'slate', direction: '偏高', note: '风险偏好缓冲' }
  ]
};

export const TACO_EVENTS = [
  { date: '2026-03-22', label: '停火谈判', score: 99 },
  { date: '2026-04-07', label: '接受停火', score: 96 },
  { date: '2026-05-18', label: 'MOU 磋商', score: 94 },
  { date: '2026-06-11', label: '重启谈判', score: 84 },
  { date: '2026-06-24', label: '伊以停火宣布', score: 77 }
];

function parseHistory(csv) {
  return String(csv || '')
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, score] = line.split(',');
      return { date, score: Number(score) };
    })
    .filter((row) => row.date && Number.isFinite(row.score));
}

export const TACO_HISTORY = parseHistory(historyCsv);

export function sampleTacoHistory(rows = TACO_HISTORY, maxPoints = 180) {
  if (rows.length <= maxPoints) return rows;
  const step = (rows.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => rows[Math.round(index * step)]);
}
