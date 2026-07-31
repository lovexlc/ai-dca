import { triggerConversionPrompt, triggerDirectAccountAuthPrompt } from '../../app/conversionPrompts.js';

export function promptNotifyConfigSuccess(meta = {}) {
  return triggerConversionPrompt('notify_config_success', meta);
}

export function promptTradeRulesSync(meta = {}) {
  return triggerDirectAccountAuthPrompt('trade_rules_sync', meta);
}

export function promptNotifyTestSuccess(meta = {}) {
  return triggerConversionPrompt('notify_test_success', meta);
}
