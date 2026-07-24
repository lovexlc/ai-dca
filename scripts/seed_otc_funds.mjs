import fs from 'node:fs/promises';

import { fetchOtcFundFullData, transformOtcFundData } from '../workers/markets/src/otcFundSync.js';
import { OTC_NASDAQ_FUNDS } from '../workers/markets/src/otcFundList.js';

const CONCURRENCY = 3;
const CACHE_TTL_SECONDS = 7 * 86400;
const QUOTE_TTL_SECONDS = 24 * 3600;

function buildQuoteEnvelope(code, quote, now = Date.now()) {
  const fetchedAt = new Date(now).toISOString();
  return {
    version: 2,
    key: `quote:${code}`,
    market: 'otc',
    fundKind: 'otc',
    source: String(quote.source || 'danjuan'),
    fetchedAt,
    asOf: quote.asOf || quote.latestNavDate || fetchedAt,
    validUntil: new Date(now + QUOTE_TTL_SECONDS * 1000).toISOString(),
    staleUntil: new Date(now + CACHE_TTL_SECONDS * 1000).toISOString(),
    payload: { ...quote, cachedAt: fetchedAt }
  };
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

async function mapLimit(items, limit, worker) {
  const results = [];
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return results;
}

const outputPath = readArg('--out');
if (!outputPath) throw new Error('usage: node scripts/seed_otc_funds.mjs --out /tmp/otc-funds.json [--codes 012751,012752]');

const requestedCodes = readArg('--codes');
const codes = requestedCodes
  ? requestedCodes.split(',').map((code) => code.trim()).filter(Boolean)
  : OTC_NASDAQ_FUNDS;

const records = [];
await mapLimit([...new Set(codes)], CONCURRENCY, async (code) => {
  try {
    const fullData = await fetchOtcFundFullData(code);
    const quote = transformOtcFundData(fullData);
    if (!quote?.latestNav || !quote.latestNavDate) {
      throw new Error('missing latest NAV');
    }
    const envelope = buildQuoteEnvelope(code, quote);
    records.push(
      {
        key: `otc-raw:${code}`,
        value: JSON.stringify(fullData),
        expiration_ttl: CACHE_TTL_SECONDS
      },
      {
        key: `quote:${code}`,
        value: JSON.stringify(envelope),
        expiration_ttl: CACHE_TTL_SECONDS
      },
      {
        // Keep the legacy key until the deployed test Worker fully consumes quote:<code>.
        key: `otc_fund:${code}`,
        value: JSON.stringify(fullData),
        expiration_ttl: CACHE_TTL_SECONDS
      }
    );
    console.log(`[seed-otc] ${code} ${quote.name} nav=${quote.latestNav} date=${quote.latestNavDate}`);
  } catch (error) {
    console.error(`[seed-otc] ${code} failed: ${error?.message || error}`);
  }
});

if (!records.length) throw new Error('no valid OTC fund records generated');
await fs.writeFile(outputPath, `${JSON.stringify(records)}\n`, 'utf8');
console.log(`[seed-otc] wrote ${records.length} KV records to ${outputPath}`);
