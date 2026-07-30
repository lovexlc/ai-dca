import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const RESOURCE_FILE = path.join(ROOT, 'workers/shared/resources.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readString(block, key) {
  return block.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] || '';
}

function bindingBlocks(text, kind) {
  const header = `[[${kind}]]`;
  return text
    .split(/(?=\[\[[^\]]+\]\])/)
    .filter((block) => block.startsWith(header));
}

function configFiles() {
  const files = [];
  for (const worker of fs.readdirSync(path.join(ROOT, 'workers'))) {
    const dir = path.join(ROOT, 'workers', worker);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (/^wrangler(?:\.test)?\.toml$/.test(file)) files.push(path.join(dir, file));
    }
  }
  return files.sort();
}

const document = readJson(RESOURCE_FILE);
const failures = [];
const seen = new Set();

for (const file of configFiles()) {
  const worker = path.basename(path.dirname(file));
  const environment = path.basename(file) === 'wrangler.test.toml' ? 'test' : 'production';
  const text = fs.readFileSync(file, 'utf8');

  for (const [tomlKind, resourceKind] of [['kv_namespaces', 'kv'], ['d1_databases', 'd1']]) {
    for (const block of bindingBlocks(text, tomlKind)) {
      const binding = readString(block, 'binding');
      if (!binding) {
        failures.push(`${path.relative(ROOT, file)}: ${tomlKind} binding is missing`);
        continue;
      }
      const lookup = `${worker}.${binding}`;
      const entry = document?.resources?.[resourceKind]?.[lookup];
      const expected = entry?.environments?.[environment];
      if (!entry || !expected) {
        failures.push(`${path.relative(ROOT, file)}: missing resources.json entry for ${resourceKind}.${lookup}.${environment}`);
        continue;
      }

      const actualId = readString(block, resourceKind === 'd1' ? 'database_id' : 'id');
      const actualPreviewId = readString(block, 'preview_id');
      const actualDatabaseName = readString(block, 'database_name');
      if (!actualId) failures.push(`${path.relative(ROOT, file)}: ${lookup} has no resource id`);
      if (actualId && actualId !== expected.id) {
        failures.push(`${path.relative(ROOT, file)}: ${lookup} id ${actualId} != resources.json ${expected.id}`);
      }
      if (actualPreviewId !== (expected.previewId || '')) {
        failures.push(`${path.relative(ROOT, file)}: ${lookup} preview_id ${actualPreviewId} != resources.json ${expected.previewId || '(empty)'}`);
      }
      if (resourceKind === 'd1' && actualDatabaseName !== (expected.databaseName || '')) {
        failures.push(`${path.relative(ROOT, file)}: ${lookup} database_name ${actualDatabaseName} != resources.json ${expected.databaseName || '(empty)'}`);
      }
      seen.add(`${resourceKind}:${lookup}:${environment}`);
    }
  }
}

for (const kind of ['kv', 'd1']) {
  for (const [lookup, entry] of Object.entries(document?.resources?.[kind] || {})) {
    for (const environment of Object.keys(entry?.environments || {})) {
      if (!seen.has(`${kind}:${lookup}:${environment}`)) {
        failures.push(`resources.json has an unbound entry: ${kind}.${lookup}.${environment}`);
      }
    }
  }
}

if (failures.length) {
  console.error('Resource contract check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Resource contract passed (${seen.size} bindings checked).`);
