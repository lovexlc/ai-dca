import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const FRONTEND_API_FILES = [
  'src/app/authClient.js',
  'src/app/accountApi.js',
  'src/app/holdingTransactionsApi.js',
  'src/app/analytics.js',
  'src/app/marketsApi.js'
];

test('CN browser API clients do not hardcode api.freebacktrack.tech', async () => {
  for (const file of FRONTEND_API_FILES) {
    const source = await readFile(file, 'utf8');
    assert.equal(source.includes('https://api.freebacktrack.tech'), false, file);
  }
});

test('CN deployment injects cn origin and blocks direct API bundle URLs', async () => {
  const source = await readFile('.github/workflows/deploy-cn-frontend.yml', 'utf8');
  assert.match(source, /CN_SITE_ORIGIN: https:\/\/cn\.freebacktrack\.tech:5000/);
  assert.match(source, /VITE_API_ORIGIN:/);
  assert.match(source, /bundle still contains direct api\.freebacktrack\.tech requests/);
  assert.match(source, /proxy_set_header Upgrade \$http_upgrade;/);
  assert.match(source, /proxy_set_header Connection \$connection_upgrade;/);
  assert.match(source, /proxy_pass https:\/\/api\.freebacktrack\.tech;/);
});
