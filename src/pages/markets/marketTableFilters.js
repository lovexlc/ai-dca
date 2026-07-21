export function normalizeTextFilterConditions(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

export function matchesTextFilterConditions(cellValue, filterValue) {
  const conditions = normalizeTextFilterConditions(filterValue);
  if (!conditions.length) return true;

  const text = String(cellValue ?? '').toLowerCase();
  return conditions.every((condition) => text.includes(condition.toLowerCase()));
}
