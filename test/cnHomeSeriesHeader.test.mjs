import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';

const source = readFileSync(new URL('../src/pages/CnHomeExperience.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/pages/cn-home.css', import.meta.url), 'utf8');
const styles = postcss.parse(css);

function declaration(selector, property) {
  const values = [];
  styles.walkRules((rule) => {
    if (rule.selector !== selector) return;
    rule.walkDecls(property, (decl) => values.push(decl.value));
  });
  return values;
}

test('series metadata appears once in the header next to the mode controls', () => {
  assert.match(source, /side=\{<div className="cn-home-market-toolbar"><span className="cn-home-series-meta">[\s\S]*?<\/span><div className="cn-home-segment"/);
  assert.equal(source.match(/className="cn-home-series-meta"/g)?.length, 1);
  assert.doesNotMatch(source, /<footer\b|cn-home-foot/);
});

test('header preserves the server window label and generated timestamp', () => {
  const metadata = source.match(/className="cn-home-series-meta">([\s\S]*?)<\/span>/)?.[1];
  assert.ok(metadata);
  assert.match(metadata, /state\.series\.data\?\.windowLabel/);
  assert.match(metadata, /timeText\(state\.series\.data\?\.generatedAt\)/);
});

test('narrow headers can wrap without squeezing the mode controls', () => {
  assert.deepEqual(declaration('.cn-home-market-toolbar', 'flex-wrap'), ['wrap']);
  assert.deepEqual(declaration('.cn-home-market-toolbar', 'min-width'), ['0']);
  assert.deepEqual(declaration('.cn-home-market-toolbar>.cn-home-segment', 'flex-shrink'), ['0']);
  assert.deepEqual(declaration('.cn-home-series-meta', 'white-space'), ['nowrap']);
});

test('removed footer spacing is not retained as a blank row', () => {
  assert.doesNotMatch(css, /\.cn-home-foot\b/);
  assert.deepEqual(declaration('.cn-home-series-meta', 'padding'), ['0']);
  assert.deepEqual(declaration('.cn-home-market .cn-home-chart-wrap', 'padding-bottom'), ['12px', '24px']);
});
