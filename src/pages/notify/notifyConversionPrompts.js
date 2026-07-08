import { triggerConversionPrompt } from '../../app/conversionPrompts.js';

export function promptNotifyConfigSuccess(meta = {}) {
  return triggerConversionPrompt('notify_config_success', meta);
}

export function promptNotifyTestSuccess(meta = {}) {
  return triggerConversionPrompt('notify_test_success', meta);
}
