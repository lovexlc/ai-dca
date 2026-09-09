// 资源级增量修改的纯函数实现：数组资源按 id 增删改，对象资源按字段 set / unset。
// 保持纯函数，便于 node --test 直接覆盖，不依赖 D1 / Workers 运行时。

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function itemCount(data) {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === 'object') return Object.keys(data).length;
  return data === null || data === undefined ? 0 : 1;
}

export function readItemId(item) {
  if (!item || typeof item !== 'object') return '';
  return String(item.id ?? '').trim();
}

export function isCollectionResource(descriptor, current, patch = {}) {
  if (descriptor?.shape === 'array') return true;
  if (descriptor?.shape === 'object') return false;
  if (Array.isArray(current)) return true;
  return Array.isArray(patch?.upsert) || Array.isArray(patch?.remove);
}

function applyCollectionPatch(current, patch = {}) {
  const base = Array.isArray(current) ? current.slice() : [];
  const index = new Map();
  base.forEach((item, position) => {
    const id = readItemId(item);
    if (id) index.set(id, position);
  });
  let changed = false;

  for (const item of Array.isArray(patch.upsert) ? patch.upsert : []) {
    const id = readItemId(item);
    if (!id) continue;
    if (index.has(id)) {
      const position = index.get(id);
      if (canonicalJson(base[position]) !== canonicalJson(item)) {
        base[position] = item;
        changed = true;
      }
      continue;
    }
    index.set(id, base.length);
    base.push(item);
    changed = true;
  }

  const removals = new Set((Array.isArray(patch.remove) ? patch.remove : []).map((id) => String(id || '').trim()).filter(Boolean));
  if (removals.size) {
    const kept = base.filter((item) => !removals.has(readItemId(item)));
    if (kept.length !== base.length) {
      return { data: kept, changed: true };
    }
  }
  return { data: base, changed };
}

function applyObjectPatch(current, patch = {}) {
  const base = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
  const before = canonicalJson(base);
  const set = patch.set && typeof patch.set === 'object' && !Array.isArray(patch.set) ? patch.set : {};
  Object.entries(set).forEach(([key, value]) => {
    base[key] = value;
  });
  for (const key of Array.isArray(patch.unset) ? patch.unset : []) {
    delete base[String(key || '')];
  }
  return { data: base, changed: canonicalJson(base) !== before };
}

export function applyResourcePatch(descriptor, current, patch = {}) {
  if (!patch || typeof patch !== 'object') return { data: current ?? null, changed: false };
  if (isCollectionResource(descriptor, current, patch)) return applyCollectionPatch(current, patch);
  return applyObjectPatch(current, patch);
}

export function upsertResourceItem(descriptor, current, itemId, item) {
  const id = String(itemId || '').trim();
  if (!id) return { data: current ?? null, changed: false };
  const normalized = item && typeof item === 'object' ? { ...item, id } : { id, value: item };
  return applyCollectionPatch(current, { upsert: [normalized] });
}

export function removeResourceItem(descriptor, current, itemId) {
  const id = String(itemId || '').trim();
  if (!id) return { data: current ?? null, changed: false };
  return applyCollectionPatch(current, { remove: [id] });
}
