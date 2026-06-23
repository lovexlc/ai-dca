import { useCallback } from 'react';
import { saveLastTransaction, addToQuickHistory } from './holdingsQuickTransaction.js';

/**
 * 持仓快速交易管理 hook
 */
export function useHoldingsQuickTransaction() {
  const recordTransaction = useCallback((normalized, draftMode) => {
    // 仅在新增交易时保存到历史
    if (draftMode === 'create') {
      saveLastTransaction({
        code: normalized.code,
        name: normalized.name || '',
        type: normalized.type,
        kind: normalized.kind,
        amount: normalized.amount
      });
      if (normalized.type === 'BUY' && normalized.amount > 0) {
        addToQuickHistory(normalized.code, normalized.name || '', 'BUY', normalized.amount);
      }
    }
  }, []);

  return { recordTransaction };
}
