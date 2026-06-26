/*
 * Browser Console helper: find and delete a holding that appears in summary
 * data but has no transaction detail.
 *
 * Usage:
 * 1. Open the app in the browser account/device where the bad holding exists.
 * 2. Open DevTools Console.
 * 3. Paste this whole file and press Enter.
 * 4. If more than one candidate is found, enter the fund code to delete.
 *
 * The script creates a localStorage backup before changing anything:
 * aiDcaHoldingsBackup:<timestamp>
 */
(() => {
  const LEDGER_KEY = 'aiDcaFundHoldingsLedger';
  const LEGACY_KEY = 'aiDcaFundHoldingsState';
  const backupKey = `aiDcaHoldingsBackup:${new Date().toISOString()}`;

  const readJson = (key, fallback) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (error) {
      console.warn(`Failed to parse ${key}; using empty fallback.`, error);
      return fallback;
    }
  };

  const getCode = (value) => String(value || '').trim();
  const ledger = readJson(LEDGER_KEY, {});
  const legacy = readJson(LEGACY_KEY, {});
  const transactions = Array.isArray(ledger.transactions) ? ledger.transactions : [];
  const snapshotsByCode = ledger.snapshotsByCode && typeof ledger.snapshotsByCode === 'object'
    ? ledger.snapshotsByCode
    : {};
  const legacyRows = Array.isArray(legacy.rows) ? legacy.rows : [];

  const txCodes = new Set(
    transactions
      .map((tx) => getCode(tx.code))
      .filter(Boolean)
  );

  const snapshotCodes = Object.keys(snapshotsByCode).filter(Boolean);
  const legacyCodes = legacyRows.map((row) => getCode(row.code)).filter(Boolean);
  const orphanCodes = Array.from(new Set([
    ...snapshotCodes.filter((code) => !txCodes.has(code)),
    ...legacyCodes.filter((code) => !txCodes.has(code))
  ])).sort();

  console.table({
    transactionCount: transactions.length,
    snapshotCount: snapshotCodes.length,
    legacyRowCount: legacyRows.length,
    orphanCodes: orphanCodes.join(', ') || '(none)'
  });

  const candidateRows = orphanCodes.map((code) => ({
    code,
    snapshotName: snapshotsByCode[code]?.name || '',
    legacyName: legacyRows.find((row) => getCode(row.code) === code)?.name || ''
  }));

  if (candidateRows.length) {
    console.table(candidateRows);
  } else {
    console.log('No orphan holding was found. You can still enter a code manually in the prompt.');
  }

  let targetCode = '';
  if (orphanCodes.length === 1) {
    targetCode = orphanCodes[0];
    const ok = window.confirm(`Found one orphan holding: ${targetCode}. Delete it?`);
    if (!ok) targetCode = '';
  } else {
    targetCode = window.prompt('Enter the fund code to delete. Leave blank to cancel.', orphanCodes[0] || '');
  }

  targetCode = getCode(targetCode);
  if (!targetCode) {
    console.log('Cancelled. No data was changed.');
    return;
  }

  const beforeTransactionCount = transactions.length;
  const beforeLegacyRowCount = legacyRows.length;
  const hadSnapshot = Object.prototype.hasOwnProperty.call(snapshotsByCode, targetCode);

  window.localStorage.setItem(backupKey, JSON.stringify({
    [LEDGER_KEY]: ledger,
    [LEGACY_KEY]: legacy
  }));

  ledger.transactions = transactions.filter((tx) => getCode(tx.code) !== targetCode);
  if (ledger.snapshotsByCode && typeof ledger.snapshotsByCode === 'object') {
    delete ledger.snapshotsByCode[targetCode];
  }

  if (Array.isArray(legacy.rows)) {
    legacy.rows = legacy.rows.filter((row) => getCode(row.code) !== targetCode);
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
  }

  window.localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));

  try {
    window.dispatchEvent(new CustomEvent('holdings:ledger-updated', { detail: { state: ledger } }));
  } catch (error) {
    console.warn('Updated localStorage, but failed to dispatch holdings update event.', error);
  }

  console.table({
    deletedCode: targetCode,
    removedTransactions: beforeTransactionCount - ledger.transactions.length,
    removedSnapshot: hadSnapshot ? 1 : 0,
    removedLegacyRows: beforeLegacyRowCount - (Array.isArray(legacy.rows) ? legacy.rows.length : 0),
    backupKey
  });

  window.location.reload();
})();
