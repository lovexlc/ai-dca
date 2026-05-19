export const SCREENING_CHECKLIST = [
  {
    id: 'first-and-unique',
    label: '"第一兼唯一"',
    description: '行业第一或拥有唯一性/核心护城河',
    critical: true
  },
  {
    id: 'revenue-growth',
    label: '营收/利润持续增长',
    description: '最近2-3年营收和净利润持续增长，非连续亏损3年',
    critical: true
  },
  {
    id: 'balance-sheet',
    label: '资产负债健康',
    description: '现金多于负债或足够覆盖刚性债务',
    critical: true
  },
  {
    id: 'cashflow',
    label: '经营现金流为正',
    description: '经营现金流持续为正，非靠借钱度日',
    critical: true
  },
  {
    id: 'industry-outlook',
    label: '行业前景好',
    description: '市场空间大 + 踩中风口 + 竞争格局好',
    critical: false
  },
  {
    id: 'valuation',
    label: '估值合理',
    description: 'PE历史百分位 < 70%，不追高',
    critical: false
  }
];

export function validateScreening(answers = {}) {
  const failures = SCREENING_CHECKLIST.filter((item) => item.critical && !answers[item.id]);
  return {
    passed: failures.length === 0,
    failures,
    message: failures.length > 0
      ? `以下关键项未通过：${failures.map((failure) => failure.label).join('、')}。建议暂不建仓。`
      : '基本面筛查通过，可创建建仓计划。'
  };
}
