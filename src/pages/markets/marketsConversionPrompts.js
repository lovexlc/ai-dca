import { trackActionResult, trackFeatureEvent } from '../../app/analytics.js';
import { triggerConversionPrompt } from '../../app/conversionPrompts.js';

export function promptMarketSymbolSelect(meta = {}) {
  return triggerConversionPrompt('markets_symbol_select', meta);
}

export function promptMarketWatchlistSave(meta = {}) {
  return triggerConversionPrompt('markets_watchlist_save', meta);
}

export function promptMarketViewPresetSave(meta = {}) {
  return triggerConversionPrompt('markets_view_preset_save', meta);
}

export function promptMarketBacktestSuccess(meta = {}) {
  return triggerConversionPrompt('markets_backtest_run_success', meta);
}

export function trackMarketBacktestEvent({ action, meta = {}, summary = {}, market = '', selectedSymbol = '' } = {}) {
  const eventMeta = {
    ...summary,
    ...meta,
    source: 'symbol_detail_backtest',
  };
  if (action === 'run_success' || action === 'run_error' || action === 'run_validation_error') {
    trackActionResult('markets', 'symbol_detail_backtest_run', action.replace(/^run_/, ''), eventMeta);
    if (action === 'run_success') {
      promptMarketBacktestSuccess({ market, symbol: String(meta.symbol || selectedSymbol || ''), source: 'symbol_detail_backtest' });
    }
    return;
  }
  trackFeatureEvent('markets', `symbol_detail_backtest_${action}`, eventMeta);
}
