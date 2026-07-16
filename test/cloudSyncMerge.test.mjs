import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeRemoteAuthoritative, mergeBackupEnvelopes } from '../src/app/cloudSync.js';

function env(payload) {
  return { payload, keys: Object.keys(payload) };
}

test('remote-authoritative: remote wins shared lww key, keeps local-only key', () => {
  const remote = env({ aiDcaVixState: JSON.stringify({ v: 'remote' }) });
  const local = env({ aiDcaVixState: JSON.stringify({ v: 'local' }), aiDcaWorkspacePrefs: JSON.stringify({ theme: 'dark' }) });
  const merged = mergeRemoteAuthoritative(remote, local);
  assert.equal(JSON.parse(merged.payload.aiDcaVixState).v, 'remote', '共有 lww：远端应覆盖');
  assert.ok(merged.payload.aiDcaWorkspacePrefs, '本地独有 key 应保留');
  assert.equal(JSON.parse(merged.payload.aiDcaWorkspacePrefs).theme, 'dark');
});

test('remote-authoritative: arrayById keeps local-only records, remote wins shared id', () => {
  const remote = env({ aiDcaMarketAlerts: JSON.stringify([{ id: 'a', note: 'remote-a' }]) });
  const local = env({ aiDcaMarketAlerts: JSON.stringify([{ id: 'a', note: 'local-a' }, { id: 'b', note: 'local-b' }]) });
  const merged = mergeRemoteAuthoritative(remote, local);
  const rows = JSON.parse(merged.payload.aiDcaMarketAlerts);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.note]));
  assert.equal(byId.a, 'remote-a', '共有记录：远端胜');
  assert.equal(byId.b, 'local-b', '本地独有记录：保留');
  assert.equal(rows.length, 2);
});

test('remote-authoritative: remote-only key is added', () => {
  const remote = env({ aiDcaPremiumState: JSON.stringify({ unlocked: true }) });
  const local = env({});
  const merged = mergeRemoteAuthoritative(remote, local);
  assert.ok(merged.payload.aiDcaPremiumState, '远端独有 key 应纳入');
});

test('remote-authoritative: watchlist unions us/cn within shared list', () => {
  const remote = env({ 'markets:watchlist:v1': JSON.stringify({ lists: [{ id: 'default', name: '默认-场内基金', type: 'cn_etf', us: ['AAPL'], cn: ['513100'], updatedAt: '2026-02-01' }], activeListId: 'default', defaultsVersion: 5 }) });
  const local = env({ 'markets:watchlist:v1': JSON.stringify({ lists: [{ id: 'default', name: '默认-场内基金', type: 'cn_etf', us: ['MSFT'], cn: ['159941'], updatedAt: '2026-01-01' }], activeListId: 'default', defaultsVersion: 5 }) });
  const merged = mergeRemoteAuthoritative(remote, local);
  const wl = JSON.parse(merged.payload['markets:watchlist:v1']);
  const def = wl.lists.find((l) => l.id === 'default');
  assert.deepEqual([...def.us].sort(), ['AAPL', 'MSFT'], '自选 us 应并集');
  assert.ok(def.cn.includes('513100') && def.cn.includes('159941'), '自选 cn 应并集');
});

test('local-authoritative merge (mergeBackupEnvelopes) still local-biased for lww', () => {
  const remote = env({ aiDcaVixState: JSON.stringify({ v: 'remote' }) });
  const local = env({ aiDcaVixState: JSON.stringify({ v: 'local' }) });
  const merged = mergeBackupEnvelopes(remote, local);
  assert.equal(JSON.parse(merged.payload.aiDcaVixState).v, 'local', '本地权威合并：lww 本地胜（既有行为不变）');
});
