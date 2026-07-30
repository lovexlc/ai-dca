function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : []).map((raw) => {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      ...source,
      date: String(source.date ?? source.navDate ?? source.day ?? '').slice(0, 10),
      nav: finiteOrNull(source.nav ?? source.unitNav ?? source.latestNav)
    };
  });
}

export function normalizeNavHistoryPayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
    ? rawPayload
    : {};
  return { ...payload, items: normalizeItems(payload.items) };
}

export function normalizeNavHistoryBatchPayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
    ? rawPayload
    : {};
  return {
    ...payload,
    items: (Array.isArray(payload.items) ? payload.items : []).map((item) => ({
      ...item,
      data: item?.data ? normalizeNavHistoryPayload(item.data) : item?.data
    }))
  };
}
