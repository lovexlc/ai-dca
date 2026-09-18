export function areHoldingTransactionsEqual(current = [], incoming = []) {
  const left = Array.isArray(current) ? current : [];
  const right = Array.isArray(incoming) ? incoming : [];
  if (left === right) return true;
  if (left.length !== right.length) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}
