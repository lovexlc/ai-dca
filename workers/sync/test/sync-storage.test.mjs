import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const BASE = 'https://api.freebacktrack.tech';
const USER_ID = 'usr_test';
const USERNAME = 'lovexl';
const TOKEN = 'tok_test_access';

async function sha256Hex(text) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function sampleEnvelope(overrides = {}) {
	return {
		version: 3,
		source: 'ai-dca-secure-sync',
		crypto: {
			alg: 'AES-GCM',
			kdf: 'PBKDF2',
			iterations: 310000,
			salt: 'c2FsdA==',
			wrapIv: 'd3JhcEl2',
			wrappedDek: 'd3JhcHBlZERlaw==',
			verifierIv: 'dmVyaWZJdg==',
			verifier: 'dmVyaWZpZXI=',
			iv: 'aXZpdml2'
		},
		meta: { contentHash: 'hash_v1', keyCount: 7 },
		ciphertext: 'Y2lwaGVydGV4dC1ibG9iLWJhc2U2NA==',
		...overrides
	};
}

// Minimal in-memory D1 + KV stand-ins that understand the exact statements the Worker issues.
function makeEnv({ backupRow = null, kvBlob = null } = {}) {
	const state = {
		analyticsEvents: [],
		sessions: new Map(),
		users: new Map([[USER_ID, USERNAME]]),
		backups: new Map()
	};
	if (backupRow) state.backups.set(USER_ID, { ...backupRow });
	const kv = new Map();
	if (kvBlob != null) kv.set(backupRow?.kvKey || `backup:${USER_ID}`, kvBlob);

	const DB = {
		prepare(sql) {
			const exec = (args = []) => ({
				async run() {
					if (/^\s*(CREATE TABLE|CREATE INDEX|ALTER TABLE)/i.test(sql)) return { success: true };
					if (/^\s*INSERT OR IGNORE INTO analytics_events/i.test(sql)) {
						const [id, type, user_id, username, visitor_id, session_id, path, event_date, created_at, meta] = args;
						if (!state.analyticsEvents.some((event) => event.id === id)) {
							state.analyticsEvents.push({ id, type, userId: user_id, username, visitorId: visitor_id, sessionId: session_id, path, date: event_date, createdAt: created_at, meta });
						}
						return { success: true };
					}
					if (/^\s*INSERT INTO backups/i.test(sql)) {
						const [user_id, version, kv_key, updated_at, key_count, bytes, content_hash, envelope, cipher_sha256] = args;
						state.backups.set(user_id, {
							version, kvKey: kv_key, updatedAt: updated_at, keyCount: key_count,
							bytes, contentHash: content_hash, envelope, cipherSha256: cipher_sha256
						});
						return { success: true };
					}
					if (/^\s*UPDATE backups/i.test(sql)) {
						if (/version = \?/i.test(sql)) {
							const [version, updated_at, key_count, bytes, content_hash, envelope, cipher_sha256] = args;
							const user_id = args[args.length - 1];
							const row = state.backups.get(user_id) || {};
							Object.assign(row, {
								version, updatedAt: updated_at, keyCount: key_count, bytes,
								contentHash: content_hash, envelope, cipherSha256: cipher_sha256
							});
							state.backups.set(user_id, row);
						} else {
							// backfill: envelope + cipher_sha256 only
							const [envelope, cipher_sha256, user_id] = args;
							const row = state.backups.get(user_id) || {};
							Object.assign(row, { envelope, cipherSha256: cipher_sha256 });
							state.backups.set(user_id, row);
						}
						return { success: true };
					}
					return { success: true };
				},
				async first() {
					if (/FROM sessions JOIN users/i.test(sql)) {
						const tokenHash = args[0];
						const uid = state.sessions.get(tokenHash);
						if (!uid) return null;
						return { id: uid, username: state.users.get(uid) };
					}
					if (/FROM backups WHERE user_id/i.test(sql)) {
						return state.backups.get(args[0]) || null;
					}
					return null;
				}
			});
			const api = exec([]);
			api.bind = (...args) => exec(args);
			return api;
		}
	};

	const SYNC_BACKUPS = {
		async get(key, opts) {
			const v = kv.get(key);
			if (v == null) return null;
			return opts?.type === 'json' ? JSON.parse(v) : v;
		},
		async put(key, val) { kv.set(key, val); }
	};

	return { env: { DB, SYNC_BACKUPS }, state, kv };
}

async function seedSession(state) {
	const tokenHash = await sha256Hex(TOKEN);
	state.sessions.set(tokenHash, USER_ID);
}

function req(method, path, { token, body } = {}) {
	const headers = { 'content-type': 'application/json' };
	if (token) headers.authorization = `Bearer ${token}`;
	return new Request(BASE + path, {
		method,
		headers,
		body: body != null ? JSON.stringify(body) : undefined
	});
}

async function legacyRow() {
	const env3 = sampleEnvelope();
	const encoded = JSON.stringify(env3);
	return {
		env3,
		encoded,
		row: {
			version: 186,
			kvKey: `backup:${USER_ID}`,
			updatedAt: '2026-06-04T07:11:32.393Z',
			keyCount: 7,
			bytes: encoded.length,
			contentHash: 'hash_v1',
			envelope: '', // legacy: only in KV
			cipherSha256: ''
		}
	};
}

test('legacy KV-only row: GET returns envelope and lazily backfills D1', async () => {
	const { env3, encoded, row } = await legacyRow();
	const { env, state } = makeEnv({ backupRow: row, kvBlob: encoded });
	await seedSession(state);
	const res = await worker.fetch(req('GET', '/api/sync/latest', { token: TOKEN }), env);
	assert.equal(res.status, 200);
	const data = await res.json();
	assert.equal(data.version, 186);
	assert.deepEqual(data.encryptedEnvelope, env3);
	// backfilled into D1 with correct checksum
	const stored = state.backups.get(USER_ID);
	assert.equal(stored.envelope, encoded);
	assert.equal(stored.cipherSha256, await sha256Hex(encoded));
});

test('D1 row: GET verifies checksum and returns envelope', async () => {
	const env3 = sampleEnvelope();
	const encoded = JSON.stringify(env3);
	const row = {
		version: 187, kvKey: `backup:${USER_ID}`, updatedAt: 't', keyCount: 7,
		bytes: encoded.length, contentHash: 'hash_v1', envelope: encoded,
		cipherSha256: await sha256Hex(encoded)
	};
	const { env, state } = makeEnv({ backupRow: row });
	await seedSession(state);
	const res = await worker.fetch(req('GET', '/api/sync/latest', { token: TOKEN }), env);
	assert.equal(res.status, 200);
	const data = await res.json();
	assert.deepEqual(data.encryptedEnvelope, env3);
});

test('corrupted D1 ciphertext: GET returns 409 STORAGE_CORRUPTED, no blob', async () => {
	const env3 = sampleEnvelope();
	const encoded = JSON.stringify(env3);
	const goodSha = await sha256Hex(encoded);
	const tampered = encoded.replace('ciphertext', 'c1phertext');
	const row = {
		version: 188, kvKey: `backup:${USER_ID}`, updatedAt: 't', keyCount: 7,
		bytes: tampered.length, contentHash: 'hash_v1', envelope: tampered,
		cipherSha256: goodSha
	};
	const { env, state } = makeEnv({ backupRow: row });
	await seedSession(state);
	const res = await worker.fetch(req('GET', '/api/sync/latest', { token: TOKEN }), env);
	assert.equal(res.status, 409);
	const data = await res.json();
	assert.equal(data.code, 'STORAGE_CORRUPTED');
	assert.equal(data.encryptedEnvelope, undefined);
});

test('PUT changed content: writes D1 atomically, bumps version, stores checksum + KV mirror', async () => {
	const { encoded, row } = await legacyRow();
	const { env, state, kv } = makeEnv({ backupRow: row, kvBlob: encoded });
	await seedSession(state);
	const next = sampleEnvelope({ meta: { contentHash: 'hash_v2', keyCount: 9 }, ciphertext: 'bmV3LWNpcGhlcnRleHQ=' });
	const res = await worker.fetch(req('PUT', '/api/sync/latest', { token: TOKEN, body: { encryptedEnvelope: next, baseVersion: 186 } }), env);
	assert.equal(res.status, 200);
	const data = await res.json();
	assert.equal(data.version, 187);
	const stored = state.backups.get(USER_ID);
	const expectedEncoded = JSON.stringify(next);
	assert.equal(stored.envelope, expectedEncoded);
	assert.equal(stored.cipherSha256, await sha256Hex(expectedEncoded));
	assert.equal(stored.contentHash, 'hash_v2');
	assert.equal(kv.get(`backup:${USER_ID}`), expectedEncoded); // rollback mirror
});

test('PUT unchanged content: returns unchanged, version unchanged', async () => {
	const env3 = sampleEnvelope();
	const encoded = JSON.stringify(env3);
	const row = {
		version: 187, kvKey: `backup:${USER_ID}`, updatedAt: 't', keyCount: 7,
		bytes: encoded.length, contentHash: 'hash_v1', envelope: encoded,
		cipherSha256: await sha256Hex(encoded)
	};
	const { env, state } = makeEnv({ backupRow: row });
	await seedSession(state);
	const res = await worker.fetch(req('PUT', '/api/sync/latest', { token: TOKEN, body: { encryptedEnvelope: sampleEnvelope() } }), env);
	assert.equal(res.status, 200);
	const data = await res.json();
	assert.equal(data.unchanged, true);
	assert.equal(data.version, 187);
});

test('PUT bad format: missing ciphertext returns 400', async () => {
	const { env, state } = makeEnv({});
	await seedSession(state);
	const bad = sampleEnvelope();
	delete bad.ciphertext;
	const res = await worker.fetch(req('PUT', '/api/sync/latest', { token: TOKEN, body: { encryptedEnvelope: bad } }), env);
	assert.equal(res.status, 400);
});

test('GET without auth returns 401', async () => {
	const { env } = makeEnv({});
	const res = await worker.fetch(req('GET', '/api/sync/latest', {}), env);
	assert.equal(res.status, 401);
});

test('OPTIONS preflight allows credentialed browser requests', async () => {
	const { env } = makeEnv({});
	const res = await worker.fetch(new Request(BASE + '/api/sync/analytics/track', {
		method: 'OPTIONS',
		headers: { origin: 'http://127.0.0.1:4173' }
	}), env);
	assert.equal(res.status, 204);
	assert.equal(res.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4173');
	assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
});

test('analytics track accepts batched events on the existing endpoint', async () => {
	const { env, state } = makeEnv({});
	const res = await worker.fetch(req('POST', '/api/sync/analytics/track', {
		body: {
			events: [
				{
					id: 'evt_one',
					type: 'page_view',
					userId: 'usr_1',
					username: 'LoveXL',
					visitorId: 'visitor_1',
					sessionId: 'session_1',
					path: '/index.html?tab=home',
					date: '2026-07-06',
					createdAt: '2026-07-06T01:02:03.000Z',
					meta: { tab: 'home' }
				},
				{ id: 'evt_two', type: 'notify_used', visitorId: 'visitor_1', meta: { notifyPlatform: 'pc' } },
				{ id: 'evt_bad', meta: { ignored: true } }
			]
		}
	}), env);

	assert.equal(res.status, 200);
	assert.deepEqual(await res.json(), { ok: true, accepted: 2 });
	assert.equal(state.analyticsEvents.length, 2);
	assert.deepEqual(state.analyticsEvents.map((event) => event.type), ['page_view', 'notify_used']);
	assert.equal(state.analyticsEvents[0].username, 'lovexl');
	assert.equal(state.analyticsEvents[0].date, '2026-07-06');
	assert.deepEqual(JSON.parse(state.analyticsEvents[1].meta), { notifyPlatform: 'pc' });
});

test('roundtrip: PUT then GET returns identical envelope with checksum verified', async () => {
	const { env, state } = makeEnv({});
	await seedSession(state);
	const payload = sampleEnvelope({ meta: { contentHash: 'rt_hash', keyCount: 3 }, ciphertext: 'cm91bmR0cmlw' });
	const putRes = await worker.fetch(req('PUT', '/api/sync/latest', { token: TOKEN, body: { encryptedEnvelope: payload } }), env);
	assert.equal(putRes.status, 200);
	const getRes = await worker.fetch(req('GET', '/api/sync/latest', { token: TOKEN }), env);
	assert.equal(getRes.status, 200);
	const data = await getRes.json();
	assert.deepEqual(data.encryptedEnvelope, payload);
	assert.equal(data.version, 1);
});
