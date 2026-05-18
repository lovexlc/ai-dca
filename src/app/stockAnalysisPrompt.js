// Structured prompt builder for the “AI 分析” button on watchlist rows in
// MarketsExperience. Uses the 金渐成 framework: 基本面 / 技术面 / 仓位 / VIX / 风险.
//
// Output is intended to be sent through `askMarketsStream({ depth: 'deep' })`,
// so the prompt should encourage the agent to call real-time tools
// (quote / kline / financials / news) instead of relying on stale knowledge.

const INDEX_SYMBOLS = new Set([
  'QQQ', 'SPY', 'VOO', 'IVV', 'QLD', 'TQQQ', 'SSO', 'UPRO',
  'DIA', 'IWM', 'VTI', 'VT',
]);

function isIndexLike(symbol) {
  const s = String(symbol || '').trim().toUpperCase();
  if (!s) return false;
  if (INDEX_SYMBOLS.has(s)) return true;
  if (s.startsWith('^')) return true; // ^VIX, ^GSPC, ^NDX...
  return false;
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function normalizeName(name) {
  return String(name || '').trim();
}

/**
 * Build the structured analysis prompt for a single watchlist symbol.
 *
 * @param {object} args
 * @param {string} args.symbol  Ticker, e.g. "NVDA", "QQQ", "^VIX".
 * @param {string} [args.name] Display name, e.g. "NVIDIA". Optional.
 * @param {'us'|'cn'} [args.market] Market hint; defaults to 'us'.
 * @returns {string}
 */
export function buildStockAnalysisPrompt({ symbol, name = '', market = 'us' } = {}) {
  const sym = normalizeSymbol(symbol);
  const nm = normalizeName(name);
  if (!sym) return '';

  const label = nm && nm !== sym ? `${sym}（${nm}）` : sym;
  const isIndex = isIndexLike(sym);
  const marketLabel = market === 'cn' ? 'A 股' : '美股';

  // 仓位指导：宽基只买不减仓，个股 70% 底仓 + 30% 做 T。
  const positionGuidance = isIndex
    ? '宽基指数策略：只买不减仓（金字塔加仓，首跌 9% 触发，每跌 3.5% 加一档，最少 7 档）。不做 T，不设减仓档位。'
    : '个股策略：70% 底仓 + 30% 做 T 仓。首次买入触发跌幅 30%，每跌 4.5% 加一档，最少 6 档。单只个股仓位上限 50%。';

  return [
    `请用「金渐成」框架对 ${marketLabel} ${label} 做一次结构化分析。`,
    '',
    '请务必先用实时行情/财报/新闻工具拉取最新数据，再下结论；不要依赖训练时记忆。',
    '',
    '输出按以下 5 个章节组织，每节 3-6 行要点，避免空话：',
    '',
    '## 一、基本面',
    '- 行业地位与护城河（一句话定性）',
    '- 最近 1-2 个季度营收/利润增速、毛利率/营业利润率',
    '- 估值（PE / PS / Forward PE 等，与同业或自身历史比较）',
    '- 最近一份财报关键亮点 / 隐忧（具体数字，注明季度）',
    '',
    '## 二、技术面',
    '- 当前价相对 MA20 / MA50 / MA200 的位置',
    '- 近 1 个月成交量与趋势（放量 / 缩量 / 异动）',
    '- 关键支撑位 / 阻力位（给出具体价位）',
    '- 距 52 周高点 / 低点的回撤幅度',
    '',
    '## 三、仓位指引',
    `- 适用策略：${positionGuidance}`,
    '- 给出基于当前价位的【下一档加仓触发价】或【建议观望条件】',
    isIndex ? '' : '- 若已有底仓，给出【建议做 T 减仓/补回区间】',
    '',
    '## 四、VIX 联动',
    '- 当前 VIX 读数（实时拉取 ^VIX）',
    '- VIX 阈值对照：< 20 谨慎 / 20-25 关注 / 25-30 加宽基 / 30-40 加全部 / > 40 重仓买入',
    '- 当前 VIX 下针对该标的的操作建议（不要给出仓位百分比承诺，只给方向）',
    '',
    '## 五、风险',
    '- 短期 3 大风险点（事件 / 财报 / 政策 / 竞争）',
    '- 建议止损 / 退出条件（具体价位或基本面变化触发）',
    '- 风险等级（低 / 中 / 高），一句话理由',
    '',
    '## 六、一句话结论',
    '不超过 30 字，必须包含【加仓 / 持有 / 减仓 / 观望】之一作为动作标签。',
    '',
    '注意：本分析仅供参考，不构成投资建议；用户需自行判断风险。',
  ].filter(Boolean).join('\n');
}

/** Exposed for unit tests / debugging. */
export const __testing = {
  isIndexLike,
  INDEX_SYMBOLS,
};
