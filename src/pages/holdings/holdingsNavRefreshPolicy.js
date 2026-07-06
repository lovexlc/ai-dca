import {
  getActiveHoldingCodeList,
  getLedgerCodeList,
  getSwitchChainCodeList,
} from '../../app/holdingsLedgerCore.js';

export function getAutoNavRefreshCodes(transactions = []) {
  return getActiveHoldingCodeList(transactions);
}

export function getManualNavRefreshCodes(transactions = []) {
  const ledgerCodes = getLedgerCodeList(transactions);
  const chainCodes = getSwitchChainCodeList(transactions);
  return [...new Set([...ledgerCodes, ...chainCodes])].sort();
}
