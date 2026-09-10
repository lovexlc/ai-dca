// Generic row codec for account resources.
// A singleton setting is one row; a collection is one row per business record.

export const META_RECORD_ID = '__meta__';
export const SINGLETON_RECORD_ID = '__singleton__';

function text(value = '', max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function itemId(item, index, prefix = 'item') {
  const raw = item?.id ?? item?.ruleId ?? item?.planId ?? item?.dcaId ?? item?.code ?? item?.symbol;
  return text(raw) || `${prefix}-${index + 1}`;
}

function row(recordId, payload, { kind = 'item', parentId = '', position = 0 } = {}) {
  return {
    recordId: text(recordId, 240),
    parentId: text(parentId, 240),
    recordKind: text(kind, 40) || 'item',
    position: Number.isFinite(Number(position)) ? Number(position) : 0,
    payload: payload ?? null
  };
}

function metaRow(payload = {}) {
  return row(META_RECORD_ID, payload, { kind: 'meta', position: 0 });
}

function singletonRow(payload = {}) {
  return row(SINGLETON_RECORD_ID, payload, { kind: 'singleton', position: 0 });
}

function splitArray(value, prefix) {
  return (Array.isArray(value) ? value : []).map((item, index) => (
    row(itemId(item, index, prefix), item, { position: index })
  ));
}

function splitPlansStore(data = {}, prefix = 'plan') {
  const { plans, ...meta } = data && typeof data === 'object' ? data : {};
  return [
    metaRow(meta),
    ...(Array.isArray(plans) ? plans : []).map((item, index) => row(itemId(item, index, prefix), item, { position: index }))
  ];
}

function splitDcaStore(data = {}) {
  const { plans, ...meta } = data && typeof data === 'object' ? data : {};
  return [
    metaRow(meta),
    ...(Array.isArray(plans) ? plans : []).map((item, index) => row(itemId(item, index, 'dca'), item, { position: index }))
  ];
}

function splitSwitchPrefs(data = {}) {
  const input = data && typeof data === 'object' ? data : {};
  const { rules, ...rawMeta } = input;
  const rows = [metaRow(rawMeta)];
  for (const [index, source] of (Array.isArray(rules) ? rules : []).entries()) {
    const id = itemId(source, index, 'rule');
    const { benchmarkCodes, enabledCodes, premiumClass, ...rule } = source && typeof source === 'object' ? source : {};
    rows.push(row(id, rule, { kind: 'item', position: index }));
    for (const [codeIndex, code] of (Array.isArray(benchmarkCodes) ? benchmarkCodes : []).entries()) {
      const value = text(code, 64);
      if (value) rows.push(row(`${id}:benchmark:${value}`, { ruleId: id, list: 'benchmarkCodes', code: value }, { kind: 'relation', parentId: id, position: codeIndex }));
    }
    for (const [codeIndex, code] of (Array.isArray(enabledCodes) ? enabledCodes : []).entries()) {
      const value = text(code, 64);
      if (value) rows.push(row(`${id}:enabled:${value}`, { ruleId: id, list: 'enabledCodes', code: value }, { kind: 'relation', parentId: id, position: codeIndex }));
    }
    for (const [codeIndex, [code, className]] of Object.entries(premiumClass || {}).entries()) {
      const value = text(code, 64);
      const normalizedClass = text(className, 8).toUpperCase();
      if (value && normalizedClass) rows.push(row(`${id}:class:${value}`, { ruleId: id, list: 'premiumClass', code: value, value: normalizedClass }, { kind: 'relation', parentId: id, position: codeIndex }));
    }
  }
  return rows;
}

function splitWatchlist(data = {}) {
  const input = data && typeof data === 'object' ? data : {};
  const { lists, us: _us, cn: _cn, ...rawMeta } = input;
  const rows = [metaRow(rawMeta)];
  for (const [listIndex, source] of (Array.isArray(lists) ? lists : []).entries()) {
    const listId = itemId(source, listIndex, 'list');
    const { us, cn, ...list } = source && typeof source === 'object' ? source : {};
    rows.push(row(listId, list, { kind: 'item', position: listIndex }));
    for (const market of ['us', 'cn']) {
      for (const [symbolIndex, symbol] of (Array.isArray(source?.[market]) ? source[market] : []).entries()) {
        const value = text(symbol, 120);
        if (value) rows.push(row(`${listId}:${market}:${value}`, { listId, market, symbol: value }, { kind: 'relation', parentId: listId, position: symbolIndex }));
      }
    }
  }
  return rows;
}

function splitHomeDashboard(data = {}) {
  const input = data && typeof data === 'object' ? data : {};
  const { watchlistCodes, ...rawMeta } = input;
  return [
    metaRow(rawMeta),
    ...(Array.isArray(watchlistCodes) ? watchlistCodes : []).map((code, index) => {
      const value = text(code, 120);
      return row(`code:${value || index + 1}`, { code: value }, { kind: 'relation', position: index });
    }).filter((item) => item.payload.code)
  ];
}

function splitNotifyClientConfig(data = {}) {
  const input = data && typeof data === 'object' ? data : {};
  const meta = { ...input };
  delete meta.barkDeviceKey;
  delete meta.serverChan3Uid;
  delete meta.serverChan3SendKey;
  delete meta.email;
  const rows = [metaRow(meta)];
  rows.push(row('channel:bark', { barkDeviceKey: text(input.barkDeviceKey, 240) }, { kind: 'channel' }));
  rows.push(row('channel:serverchan3', {
    serverChan3Uid: text(input.serverChan3Uid, 120),
    serverChan3SendKey: text(input.serverChan3SendKey, 240)
  }, { kind: 'channel' }));
  if (input.email && typeof input.email === 'object') rows.push(row('channel:email', input.email, { kind: 'channel' }));
  return rows;
}

export function splitResourceRows(descriptor, data) {
  const resource = String(descriptor?.resource || '');
  if (resource === 'holdings/position-snapshot' || resource === 'holdings/ledger') return [];
  if (resource === 'plans/store') return splitPlansStore(data, 'plan');
  if (resource === 'dca/store') return splitDcaStore(data);
  if (resource === 'fund-switch/prefs') return splitSwitchPrefs(data);
  if (resource === 'markets/watchlist') return splitWatchlist(data);
  if (resource === 'prefs/home-dashboard') return splitHomeDashboard(data);
  if (resource === 'notify/client-config') return splitNotifyClientConfig(data);
  if (descriptor?.shape === 'array') return splitArray(data, resource.replace(/[^a-z0-9]+/gi, '-') || 'item');
  return [singletonRow(data)];
}

function payloadOf(record) {
  if (record?.payload && typeof record.payload === 'object') return record.payload;
  try { return JSON.parse(String(record?.payload || 'null')); } catch { return null; }
}

function activeRecords(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((record) => Number(record?.deleted || 0) !== 1)
    .sort((left, right) => Number(left?.position || 0) - Number(right?.position || 0));
}

function assemblePlansStore(rows) {
  const active = activeRecords(rows);
  const meta = payloadOf(active.find((record) => record.record_id === META_RECORD_ID || record.recordKind === 'meta')) || {};
  const plans = active.filter((record) => record.record_id !== META_RECORD_ID && record.record_kind !== 'meta').map(payloadOf).filter(Boolean);
  return { ...meta, plans };
}

function assembleDcaStore(rows) {
  return assemblePlansStore(rows);
}

function assembleSwitchPrefs(rows) {
  const active = activeRecords(rows);
  const meta = { ...(payloadOf(active.find((record) => record.record_id === META_RECORD_ID || record.record_kind === 'meta')) || {}) };
  const rules = active.filter((record) => record.record_id !== META_RECORD_ID && record.record_kind === 'item').map((record) => ({ ...payloadOf(record), benchmarkCodes: [], enabledCodes: [], premiumClass: {} }));
  const byId = new Map(rules.map((rule) => [String(rule.id || ''), rule]));
  for (const record of active.filter((item) => item.record_kind === 'relation')) {
    const payload = payloadOf(record) || {};
    const rule = byId.get(String(payload.ruleId || record.parent_id || ''));
    if (!rule) continue;
    if (payload.list === 'benchmarkCodes') rule.benchmarkCodes.push(payload.code);
    if (payload.list === 'enabledCodes') rule.enabledCodes.push(payload.code);
    if (payload.list === 'premiumClass') rule.premiumClass[payload.code] = payload.value;
  }
  return { ...meta, rules };
}

function assembleWatchlist(rows) {
  const active = activeRecords(rows);
  const meta = { ...(payloadOf(active.find((record) => record.record_id === META_RECORD_ID || record.record_kind === 'meta')) || {}) };
  const lists = active.filter((record) => record.record_kind === 'item' && record.record_id !== META_RECORD_ID).map((record) => ({ ...payloadOf(record), us: [], cn: [] }));
  const byId = new Map(lists.map((list) => [String(list.id || ''), list]));
  for (const record of active.filter((item) => item.record_kind === 'relation')) {
    const payload = payloadOf(record) || {};
    const list = byId.get(String(payload.listId || record.parent_id || ''));
    if (list && (payload.market === 'us' || payload.market === 'cn') && payload.symbol) list[payload.market].push(payload.symbol);
  }
  const activeList = byId.get(String(meta.activeListId || '')) || lists[0] || { us: [], cn: [] };
  return { ...meta, lists, us: activeList.us || [], cn: activeList.cn || [] };
}

function assembleHomeDashboard(rows) {
  const active = activeRecords(rows);
  const meta = { ...(payloadOf(active.find((record) => record.record_id === META_RECORD_ID || record.record_kind === 'meta')) || {}) };
  const watchlistCodes = active.filter((record) => record.record_kind === 'relation' && record.record_id !== META_RECORD_ID).map((record) => payloadOf(record)?.code).filter(Boolean);
  return { ...meta, watchlistCodes };
}

function assembleNotifyClientConfig(rows) {
  const active = activeRecords(rows);
  const meta = { ...(payloadOf(active.find((record) => record.record_id === META_RECORD_ID || record.record_kind === 'meta')) || {}) };
  for (const record of active.filter((item) => item.record_kind === 'channel')) Object.assign(meta, payloadOf(record) || {});
  const email = payloadOf(active.find((record) => record.record_id === 'channel:email'));
  if (email) meta.email = email;
  return meta;
}

export function assembleResourceRows(descriptor, rows = []) {
  const resource = String(descriptor?.resource || '');
  if (resource === 'plans/store') return assemblePlansStore(rows);
  if (resource === 'dca/store') return assembleDcaStore(rows);
  if (resource === 'fund-switch/prefs') return assembleSwitchPrefs(rows);
  if (resource === 'markets/watchlist') return assembleWatchlist(rows);
  if (resource === 'prefs/home-dashboard') return assembleHomeDashboard(rows);
  if (resource === 'notify/client-config') return assembleNotifyClientConfig(rows);
  const active = activeRecords(rows);
  if (descriptor?.shape === 'array') return active.filter((record) => record.record_id !== META_RECORD_ID).map(payloadOf).filter((item) => item !== null && item !== undefined);
  return payloadOf(active.find((record) => record.record_id === SINGLETON_RECORD_ID || record.record_kind === 'singleton')) ?? null;
}

export function rowCount(rows = []) {
  return activeRecords(rows).filter((record) => record.record_kind !== 'meta').length;
}
