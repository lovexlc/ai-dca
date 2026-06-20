import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);

const BASE_REQUIRED_FILES = [
  'src/pages/holdings/AggregateHoldingsTableSection.jsx',
  'src/pages/holdings/HoldingSummaryPanel.jsx',
  'src/pages/holdings/HoldingsSidePanel.jsx',
  'src/pages/holdings/SwitchCounterpartPickerModal.jsx',
  'src/pages/holdings/TransactionDraftPanel.jsx',
  'src/pages/holdings/TransactionImportModals.jsx',
  'src/pages/holdings/aggregateHoldingsColumns.jsx',
  'src/pages/markets/MarketChartPanel.jsx',
  'src/pages/markets/MarketFinancialPanels.jsx',
  'src/pages/markets/MarketListTable.jsx',
  'src/pages/markets/MarketNewsPanels.jsx',
  'src/pages/markets/MarketSidebarRows.jsx',
  'src/pages/markets/MarketSymbolDetailPanel.jsx',
  'src/pages/markets/MarketsResearchPanel.jsx',
  'src/pages/markets/marketDisplayUtils.js',
  'src/pages/markets/marketFundMetrics.js'
];

const REFACTOR_PHASES = [
  {
    name: 'holdings overview shell',
    activationFile: 'src/pages/holdings/HoldingsOverviewShell.jsx',
    requiredFiles: [
      'src/pages/holdings/HoldingsOverviewShell.jsx',
      'src/pages/holdings/holdingsClipboardExport.js'
    ],
    budgets: [['src/pages/HoldingsExperience.jsx', 1300]]
  },
  {
    name: 'markets shell continuation',
    activationFile: 'src/pages/markets/MarketsMainContent.jsx',
    requiredFiles: [
      'src/pages/markets/MarketsMainContent.jsx',
      'src/pages/markets/MarketsResearchShell.jsx',
      'src/pages/markets/MarketsSidebar.jsx',
      'src/pages/markets/marketOtcHelpers.js'
    ],
    budgets: [['src/pages/MarketsExperience.jsx', 1520]]
  },
  {
    name: 'switch strategy panels',
    activationFile: 'src/pages/SwitchStrategyOpportunityPanels.jsx',
    requiredFiles: [
      'src/pages/SwitchStrategyClassificationPanel.jsx',
      'src/pages/SwitchStrategyOpportunityPanels.jsx',
      'src/pages/SwitchStrategyPanels.jsx',
      'src/pages/switchStrategyHelpers.js'
    ],
    budgets: [['src/pages/SwitchStrategyExperience.jsx', 1100]]
  },
  {
    name: 'notify page cards',
    activationFile: 'src/pages/NotifyConfigCard.jsx',
    requiredFiles: [
      'src/pages/NotifyConfigCard.jsx',
      'src/pages/NotifyHistoryCard.jsx',
      'src/pages/notifyHistoryHelpers.js'
    ],
    budgets: [['src/pages/NotifyExperience.jsx', 880]]
  },
  {
    name: 'new plan shell',
    activationFile: 'src/pages/NewPlanShell.jsx',
    requiredFiles: [
      'src/pages/NewPlanConfigCards.jsx',
      'src/pages/NewPlanPreviewSidebar.jsx',
      'src/pages/NewPlanSelectionCards.jsx',
      'src/pages/NewPlanShell.jsx'
    ],
    budgets: [['src/pages/NewPlanExperience.jsx', 650]]
  },
  {
    name: 'markets worker runtime',
    activationFile: 'workers/markets/src/marketRuntime.js',
    requiredFiles: [
      'workers/markets/src/marketRuntime.js',
      'workers/markets/src/newsFetchers.js'
    ],
    budgets: [['workers/markets/src/index.js', 850]]
  },
  {
    name: 'notify worker routes',
    activationFile: 'workers/notify/src/notificationRuleEvaluation.js',
    requiredFiles: [
      'workers/notify/src/deliveryEngine.js',
      'workers/notify/src/holdingsNotificationRoutes.js',
      'workers/notify/src/notificationRuleEvaluation.js',
      'workers/notify/src/switchStrategyRoutes.js'
    ],
    budgets: [
      ['workers/notify/src/evaluator.js', 700],
      ['workers/notify/src/index.js', 600]
    ],
    forbiddenPatterns: [
      ['workers/notify/src/evaluator.js', /\b(?:function|const)\s+buildNotificationMessage\b/, 'notification message construction belongs in notificationRuleEvaluation.js']
    ]
  },
  {
    name: 'ocr proxy route modules',
    activationFile: 'workers/ocr-proxy/src/imageOcrRoutes.js',
    requiredFiles: [
      'workers/ocr-proxy/src/fundRoutes.js',
      'workers/ocr-proxy/src/imageOcrRoutes.js'
    ],
    budgets: [['workers/ocr-proxy/src/index.js', 250]],
    forbiddenPatterns: [
      ['workers/ocr-proxy/src/index.js', /\b(?:function|const)\s+handleAiChat\b/, 'AI chat route was removed from ocr-proxy'],
      ['workers/ocr-proxy/src/index.js', /\b(?:function|const)\s+handleImageOcr\b/, 'image OCR route belongs in imageOcrRoutes.js']
    ]
  }
];

const BASE_LINE_BUDGETS = [
  ['src/pages/MarketsExperience.jsx', 1900],
  ['src/pages/HoldingsExperience.jsx', 1300],
  ['src/pages/SwitchStrategyExperience.jsx', 1900],
  ['src/pages/NotifyExperience.jsx', 1150],
  ['src/pages/NewPlanExperience.jsx', 1000],
  ['workers/ocr-proxy/src/index.js', 950],
  ['workers/markets/src/index.js', 1250],
  ['workers/notify/src/evaluator.js', 1300],
  ['workers/notify/src/index.js', 1450]
];

const FORBIDDEN_PATTERNS = [
  ['src/pages/HoldingsExperience.jsx', /\bmainViewTab\b/, 'legacy holdings tab branching must stay removed'],
  ['src/pages/HoldingsExperience.jsx', /\brenderLedgerTable\b/, 'legacy holdings ledger table renderer must stay removed'],
  ['src/pages/HoldingsExperience.jsx', /\brenderSwitchChainView\b/, 'legacy switch-chain view renderer must stay removed'],
  ['src/pages/HoldingsExperience.jsx', /\bLedgerTransactionRow\b/, 'legacy ledger row component must stay removed'],
  ['src/pages/HoldingsExperience.jsx', /\bSwitchChainPickerModal\b/, 'legacy switch-chain picker must stay removed'],
  ['src/pages/MarketsExperience.jsx', /\bfunction\s+SymbolDetailChart\b/, 'chart presentation belongs in MarketChartPanel.jsx'],
  ['src/pages/MarketsExperience.jsx', /\bfunction\s+SymbolDetailPanel\b/, 'symbol detail presentation belongs in MarketSymbolDetailPanel.jsx'],
  ['src/pages/MarketsExperience.jsx', /\bfunction\s+MarketsResearchPanel\b/, 'research presentation belongs in MarketsResearchPanel.jsx']
];

function fullPath(relativePath) {
  return path.join(ROOT, relativePath);
}

function exists(relativePath) {
  return fs.existsSync(fullPath(relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(fullPath(relativePath), 'utf8');
}

function lineCount(text) {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

const failures = [];

for (const relativePath of BASE_REQUIRED_FILES) {
  if (!exists(relativePath)) {
    failures.push(`missing baseline extracted module: ${relativePath}`);
  }
}

const budgetByFile = new Map(BASE_LINE_BUDGETS);

for (const phase of REFACTOR_PHASES.filter((item) => exists(item.activationFile))) {
  for (const relativePath of phase.requiredFiles) {
    if (!exists(relativePath)) {
      failures.push(`phase "${phase.name}" is active but missing extracted module: ${relativePath}`);
    }
  }
  for (const [relativePath, maxLines] of phase.budgets) {
    budgetByFile.set(relativePath, Math.min(budgetByFile.get(relativePath) ?? maxLines, maxLines));
  }
  if (Array.isArray(phase.forbiddenPatterns)) {
    FORBIDDEN_PATTERNS.push(...phase.forbiddenPatterns);
  }
}

for (const [relativePath, maxLines] of budgetByFile.entries()) {
  if (!exists(relativePath)) {
    failures.push(`missing guarded file: ${relativePath}`);
    continue;
  }
  const lines = lineCount(readText(relativePath));
  if (lines > maxLines) {
    failures.push(`${relativePath} has ${lines} lines; budget is ${maxLines}. Extract new functionality instead of growing the orchestration file.`);
  }
}

for (const [relativePath, pattern, message] of FORBIDDEN_PATTERNS) {
  if (!exists(relativePath)) continue;
  if (pattern.test(readText(relativePath))) {
    failures.push(`${relativePath}: ${message}`);
  }
}

if (failures.length) {
  console.error('Refactor guard failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Refactor guard passed.');
