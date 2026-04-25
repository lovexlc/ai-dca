// FundSwitch (换仓分析) 页的纯常量与工具函数。
// 从 FundSwitchExperience.jsx 抽离，便于单元测试与复用。
import { Sparkles, SlidersHorizontal, TableProperties } from 'lucide-react';
import { formatCurrency } from './accumulation.js';
import { buildFundSwitchViewHash, parseFundSwitchHashRoute } from './fundSwitch.js';
import { formatPriceAsOf } from './nasdaqPrices.js';

export const FUND_CODE_PATTERN = /^\d{6}$/;
export const OCR_MAX_FILE_SIZE = 10 * 1024 * 1024;
export const STRATEGY_LABELS = {
  trace: '追溯最初买入',
  direct: '只看最后一次'
};
export const STRATEGY_DESCRIPTIONS = {
  trace: '推荐。把中间几次换仓一起算进去，更接近“如果当初不换，现在值多少”。',
  direct: '只判断最后一步换仓是否划算，不追溯更早的来源基金。'
};
export const LANDING_SCROLL_PANELS = [
  [
    {
      duration: '22s',
      delay: '-8s',
      items: [
        '如果当初不换，现在值多少？',
        '换到现在这只后，当前多赚还是少赚？',
        '中间补进去的钱算进去了吗？',
        '哪几笔识别结果需要我手动改？'
      ]
    },
    {
      duration: '26s',
      delay: '-5s',
      items: [
        '来源仓位到底是从哪只基金来的？',
        '只看最后一次还是追溯最初买入？',
        'OCR 识别错的代码和份额可以改吗？',
        '现价同步到了哪一天？'
      ]
    },
    {
      duration: '20s',
      delay: '-11s',
      items: [
        '如果不换，现在会比现在多多少？',
        '手续费和额外补入现金算进去了吗？',
        '保存过的分析还能直接重算吗？',
        '这次换仓现在到底赚了还是亏了？'
      ]
    }
  ],
  [
    {
      duration: '22s',
      delay: '-13s',
      items: [
        '识别截图里的买入和卖出记录',
        '自动回放来源仓位和目标仓位',
        '按最新价格重算当前切换收益',
        '保存历史分析，后续一键打开重算'
      ]
    },
    {
      duration: '26s',
      delay: '-9s',
      items: [
        '修改识别明细后可以立刻重新计算',
        '来源基金会按你的收益口径回溯',
        '切换成本和手续费都可以手动校准',
        '历史记录点开就会用最新价格重算'
      ]
    },
    {
      duration: '20s',
      delay: '-6s',
      items: [
        '当前不切换现值是多少？',
        '当前换后现值是多少？',
        '哪条识别记录需要人工复核？',
        '收益摘要会自动保存进历史吗？'
      ]
    }
  ]
];
export const LANDING_MOBILE_SCROLL_ROWS = [
  LANDING_SCROLL_PANELS[0][0],
  LANDING_SCROLL_PANELS[1][1],
  LANDING_SCROLL_PANELS[0][2]
];
export const WORKSPACE_PANELS = [
  { key: 'details', label: '识别明细', Icon: TableProperties },
  { key: 'summary', label: '收益摘要', Icon: Sparkles },
  { key: 'settings', label: '计算参数', Icon: SlidersHorizontal }
];

export function createOcrState(overrides = {}) {
  return {
    status: 'idle',
    progress: 0,
    message: '等待上传交易截图。',
    durationMs: 0,
    error: '',
    lineCount: 0,
    ...overrides
  };
}

export function formatSignedCurrency(value, prefix = '¥ ') {
  const absoluteValue = formatCurrency(Math.abs(value), prefix);
  if (value > 0) {
    return `+${absoluteValue}`;
  }
  if (value < 0) {
    return `-${absoluteValue}`;
  }
  return absoluteValue;
}

export function getAdvantageTone(value) {
  if (value > 0) {
    return { className: 'border border-emerald-200 bg-emerald-50 text-emerald-600', label: '当前领先' };
  }
  if (value < 0) {
    return { className: 'border border-red-200 bg-red-50 text-red-600', label: '当前落后' };
  }
  return { className: 'border border-slate-200 bg-slate-50 text-slate-600', label: '基本持平' };
}

export function formatDateTimeLabel(value = '') {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) {
    return '--';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(timestamp)).replace(/\//g, '-');
}

export function getFundCodeError(code) {
  const value = String(code || '').trim();
  if (!value) {
    return '';
  }
  return FUND_CODE_PATTERN.test(value) ? '' : '代码必须是 6 位纯数字。';
}

export function validateOcrUploadFile(file) {
  if (!file || typeof file !== 'object') {
    throw new Error('未找到要上传的截图。');
  }

  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('当前仅支持常见图片格式。');
  }

  if (Number(file.size) > OCR_MAX_FILE_SIZE) {
    throw new Error('图片请控制在 10MB 内。');
  }
}

export function readFundSwitchRouteState() {
  if (typeof window === 'undefined') {
    return { mode: 'upload', docId: '' };
  }
  return parseFundSwitchHashRoute(window.location.hash);
}

export function updateFundSwitchRoute(nextRoute, { replace = false } = {}) {
  if (typeof window === 'undefined') {
    return nextRoute;
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.hash = nextRoute.mode === 'view' ? buildFundSwitchViewHash(nextRoute.docId || '').slice(1) : '';
  window.history[replace ? 'replaceState' : 'pushState'](window.history.state, '', nextUrl);
  return nextRoute;
}

export function buildTrackedCodes(comparison = {}) {
  const codeSet = new Set();

  for (const position of comparison.sourcePositions || []) {
    if (position?.code) {
      codeSet.add(position.code);
    }
  }

  for (const position of comparison.targetPositions || []) {
    if (position?.code) {
      codeSet.add(position.code);
    }
  }

  if (comparison.sourceCode) {
    codeSet.add(comparison.sourceCode);
  }

  if (comparison.targetCode) {
    codeSet.add(comparison.targetCode);
  }

  return [...codeSet];
}

export function formatPositionMeta(position, snapshot) {
  if (position.currentPrice > 0) {
    const base = `${position.code}，${position.shares} 份，单价 ${Number(position.currentPrice).toFixed(4)}`;
    return snapshot ? `${base}，现价日期 ${formatPriceAsOf(snapshot)}` : `${base}，手动现价`;
  }

  return `${position.code}，${position.shares} 份，待补现价`;
}

export function roundToCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function hasMeaningfulRowContent(row) {
  return Boolean(
    String(row?.date || '').trim()
      || String(row?.code || '').trim()
      || Number(row?.price) > 0
      || Number(row?.shares) > 0
      || Number(row?.amount) > 0
  );
}

export function isValidRowDate(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }

  return Number.isFinite(Date.parse(normalized.replace(' ', 'T')));
}

export function buildRowValidationDiagnostics(rows = []) {
  const normalizedRows = (Array.isArray(rows) ? rows : []).filter((row) => hasMeaningfulRowContent(row));
  if (!normalizedRows.length) {
    return [{
      id: 'rows-empty',
      rowIndex: -1,
      rowLabel: '',
      field: 'rows',
      message: '请至少保留一条有效交易记录。'
    }];
  }

  const diagnostics = [];
  normalizedRows.forEach((row, index) => {
    const rowLabel = `第 ${index + 1} 条记录`;
    const price = Number(row?.price) || 0;
    const shares = Number(row?.shares) || 0;
    const amount = Number(row?.amount) || 0;
    const expectedAmount = roundToCurrency(price * shares);

    if (!isValidRowDate(row?.date)) {
      diagnostics.push({
        id: `${row.id || index}-date`,
        rowIndex: index,
        rowLabel,
        field: 'date',
        message: '日期不完整或格式不正确。'
      });
    }
    if (getFundCodeError(row?.code)) {
      diagnostics.push({
        id: `${row.id || index}-code`,
        rowIndex: index,
        rowLabel,
        field: 'code',
        message: '基金代码必须是 6 位纯数字。'
      });
    }
    if (row?.type !== '买入' && row?.type !== '卖出') {
      diagnostics.push({
        id: `${row.id || index}-type`,
        rowIndex: index,
        rowLabel,
        field: 'type',
        message: '交易类型不正确。'
      });
    }
    if (price <= 0) {
      diagnostics.push({
        id: `${row.id || index}-price`,
        rowIndex: index,
        rowLabel,
        field: 'price',
        message: '价格必须大于 0。'
      });
    }
    if (shares <= 0) {
      diagnostics.push({
        id: `${row.id || index}-shares`,
        rowIndex: index,
        rowLabel,
        field: 'shares',
        message: '份额必须大于 0。'
      });
    }
    if (amount <= 0) {
      diagnostics.push({
        id: `${row.id || index}-amount-empty`,
        rowIndex: index,
        rowLabel,
        field: 'amount',
        message: '成交额不能为空。'
      });
    } else if (price > 0 && shares > 0 && Math.abs(amount - expectedAmount) > 0.05) {
      diagnostics.push({
        id: `${row.id || index}-amount-mismatch`,
        rowIndex: index,
        rowLabel,
        field: 'amount',
        message: '成交额与价格份额不一致。'
      });
    }
  });

  return diagnostics;
}

export function buildRowValidationIssues(diagnostics = []) {
  return (Array.isArray(diagnostics) ? diagnostics : []).map((diagnostic) => (
    diagnostic.rowIndex >= 0 && diagnostic.rowLabel
      ? `${diagnostic.rowLabel} ${diagnostic.message}`
      : diagnostic.message
  ));
}

export function summarizeValidationIssues(diagnostics = []) {
  const issues = buildRowValidationIssues(diagnostics);
  if (!issues.length) {
    return '';
  }

  const preview = issues.slice(0, 2).join('；');
  return issues.length > 2 ? `${preview}；另有 ${issues.length - 2} 项待修正。` : preview;
}
