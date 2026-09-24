import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const stubSources = new Map([
  ['/src/notifyHttp.js', "export function jsonResponse(payload) { return new Response(JSON.stringify(payload)); } export function readOrigin() { return ''; }"],
  ['/src/notifyAccountAuth.js', "export const VERIFIED_NOTIFY_USER_ID_HEADER = 'x-user'; export const VERIFIED_NOTIFY_USERNAME_HEADER = 'x-username';"],
  ['/src/clientSettings.js', "export function buildAccountClientId(id) { return 'account:' + id; } export function normalizeNotifyUserId(id) { return String(id || ''); }"],
  ['/src/switchStrategy.js', "export function normalizeSwitchConfig(value) { return value; } export function switchConfigKey(id) { return 'switch:config:' + id; }"],
  ['/src/accountResourceSettings.js', "export async function readAccountResourceNotifySettings() { return null; } export function mergeAccountResourceNotifySettings(base) { return base; }"],
  ['/src/notifyReliabilityStorage.js', [
    "export async function reserveDeliveryAttempt(env) {",
    "  await new Promise(resolve => {",
    "    env.gate.waiters.push(resolve);",
    "    if (env.gate.waiters.length === env.gate.expected) for (const done of env.gate.waiters) done();",
    "  });",
    "  return { reserved: true };",
    "}",
    "export async function finishDeliveryAttempt(env, owner, eventId, channel, result) { return result; }",
    "export function isRetryableDeliveryStatus(status) { return status === 'failed'; }",
    "export async function markTriggerOutboxCancelled() {}",
    "export async function markTriggerOutboxDelivered() {}",
    "export async function markTriggerOutboxRetryable() { return {terminal:true}; }",
    "export async function reserveDailyEmailQuota(env, entry) { env.quota.push(entry); return { allowed: true, slot: 1 }; }",
    "export async function markDailyEmailQuotaDelivered() {}",
    "export async function releaseDailyEmailQuota() {}"
  ].join('\n')],
  ['/src/channels/bark.js', "export async function sendBarkNotification(message) { message.params.audit.push({channel:'bark',eventId:message.eventId,destination:message.deviceKey}); return {channel:'bark',status:'delivered'}; }"],
  ['/src/channels/serverChan3.js', "export async function sendServerChan3Notification(message) { message.params.audit.push({channel:'serverchan3',eventId:message.eventId,destination:message.sendKey}); return {channel:'serverchan3',status:'delivered'}; }"],
  ['/src/channels/email.js', [
    "export function maskEmailAddress(address) { return String(address).slice(0,2) + '***'; }",
    "export function normalizeEmailConfig(config) { return config || {}; }",
    "export async function prepareSwitchEmailNotification(notification) { return notification; }",
    "export async function sendVerifiedEmailNotification(message, env) { env.sent.push({channel:'email',eventId:message.eventId,destination:message.email.address}); return {channel:'email',status:'delivered'}; }"
  ].join('\n')],
  ['/src/gcm.js', "export function hasWebWsCapability() {return false;} export function isRegistrationPairedToScope() {return false;} export function isWebWsRegistration() {return false;} export function normalizeGcmRegistrations() {return [];} export function normalizeNotifyGroupId(id) {return id;}"],
  ['/src/wsHub.js', "export async function tryPublishWs() { return {ok:false}; }"],
  ['/src/deliverySettlement.js', "export async function settleNamedDeliveryJobs(jobs) { return Promise.all(jobs.map(job => job.promise)); }"]
]);

async function loadProductionModules() {
  const context = vm.createContext({ console, Date, Response, Headers, URL, crypto: globalThis.crypto });
  const moduleCache = new Map();
  function getModule(identifier) {
    if (moduleCache.has(identifier)) return moduleCache.get(identifier);
    let source = stubSources.get(identifier);
    if (identifier === '/src/accountDeliveryRoute.js' || identifier === '/src/deliveryEngine.js') {
      source = readFileSync(new URL('../src/' + path.posix.basename(identifier), import.meta.url), 'utf8');
    }
    if (source === undefined) throw new Error('Missing module stub: ' + identifier);
    const module = new vm.SourceTextModule(source, { context, identifier });
    moduleCache.set(identifier, module);
    return module;
  }
  const entry = getModule('/src/accountDeliveryRoute.js');
  await entry.link((specifier, parent) => getModule(path.posix.normalize(path.posix.join(path.posix.dirname(parent.identifier), specifier))));
  await entry.evaluate();
  return { route: entry.namespace, engine: getModule('/src/deliveryEngine.js').namespace };
}

function fakeDb(env) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              if (sql.includes("record_type = 'client-channel'")) {
                const owner = args[0];
                return { results: [
                  { record_id: args[1], payload: JSON.stringify({ barkDeviceKey: env.accounts[owner].bark }) },
                  { record_id: args[2], payload: JSON.stringify({ serverChan3: { uid:'uid', sendKey: env.accounts[owner].server } }) },
                  { record_id: args[3], payload: JSON.stringify({ email: { address: env.accounts[owner].email, verified: true, enabled: true } }) }
                ] };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes("record_type = 'client'")) return { payload: JSON.stringify({clientLabel: args[0]}) };
              return null;
            },
            async run() { return { meta: { changes: 1 } }; }
          };
        }
      };
    },
    async batch() { return []; }
  };
}

test('concurrent accounts keep email, bark, quota and client labels isolated', async () => {
  const { route } = await loadProductionModules();
  const count = 24;
  const env = {
    accounts: {
      'user-a': { email: 'a@example.test', bark: 'bark-a', server: 'server-a' },
      'user-b': { email: 'b@example.test', bark: 'bark-b', server: 'server-b' }
    },
    gate: { expected: count * 4, waiters: [] },
    sent: [],
    quota: []
  };
  env.SYNC_DB = fakeDb(env);
  const requests = Array.from({length: count}, (_, index) => {
    const userId = index % 2 === 0 ? 'user-a' : 'user-b';
    return route.deliverAccountNotification(
      env,
      { userId, username: userId, clientId: 'account:' + userId },
      { eventId: 'event-' + index, eventType: 'test', title: 'test', body: 'test', params: {audit: env.sent} },
      ['email','bark','serverchan3','pc']
    );
  });
  const responses = await Promise.all(requests);
  assert.equal(responses.length, count);
  assert.equal(env.sent.length, count * 3);
  for (const item of env.sent) {
    const index = Number(item.eventId.slice(6));
    const account = env.accounts[index % 2 === 0 ? 'user-a' : 'user-b'];
    const expected = item.channel === 'email' ? account.email : item.channel === 'bark' ? account.bark : account.server;
    assert.equal(item.destination, expected, item.eventId + ':' + item.channel);
  }
  assert.equal(env.quota.length, count);
  for (const item of env.quota) {
    const index = Number(item.eventId.slice(6));
    assert.equal(item.ownerUserId, index % 2 === 0 ? 'user-a' : 'user-b');
  }
  for (const [index, response] of responses.entries()) {
    assert.equal(response.clientId, 'account:' + (index % 2 === 0 ? 'user-a' : 'user-b'));
    assert.equal(response.events[0].channels.find(item => item.channel === 'pc')?.configKey, 'pc-client:' + response.clientId);
  }
});

test('expected owner rejects a mismatched settings object before delivery', async () => {
  const { engine } = await loadProductionModules();
  const env = { sent: [], SYNC_DB: fakeDb({accounts:{}}) };
  await assert.rejects(
    engine.deliverNotification(env, {eventId:'event-mismatch'}, {
      settings:{ownerUserId:'user-b',email:{address:'b@example.test',verified:true,enabled:true}},
      clientId:'account:user-a',expectedOwnerUserId:'user-a',deliveryDirect:true,targetChannels:['email']
    }),
    /owner mismatch/
  );
  assert.equal(env.sent.length, 0);
});

test('account queue work leaves legacy notification context untouched', async () => {
  const { route, engine } = await loadProductionModules();
  const legacySettings = {
    ownerUserId: 'legacy',
    accountClientId: 'legacy-client',
    email: {address:'legacy@example.test',verified:true,enabled:true}
  };
  const env = {
    accounts: {'user-a': {email:'a@example.test',bark:'bark-a'}},
    gate: {expected: 99,waiters:[]},
    sent:[],
    quota:[],
    __notifySettings: legacySettings,
    __notifyCurrentClientId:'legacy-client',
    __notifyDeliveryDirect:true
  };
  env.SYNC_DB = fakeDb(env);
  const queued = route.deliverAccountNotification(
    env,
    { userId:'user-a', username:'user-a', clientId:'account:user-a' },
    {eventId:'event-account',eventType:'test',title:'test',body:'test'},
    ['email']
  );
  for (let attempt = 0; attempt < 100 && env.gate.waiters.length === 0; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(env.gate.waiters.length, 1);
  try {
    await engine.deliverNotification(env, {eventId:'event-legacy',eventType:'test'}, {
      targetChannels:['email'],deliveryDirect:true
    });
  } finally {
    for (const done of env.gate.waiters) done();
    await queued;
  }
  assert.equal(env.sent.find(item => item.eventId === 'event-legacy')?.destination, 'legacy@example.test');
  assert.equal(env.__notifySettings, legacySettings);
  assert.equal(env.__notifyCurrentClientId, 'legacy-client');
});
