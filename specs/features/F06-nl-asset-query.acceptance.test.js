// Acceptance tests for F06 — natural-language asset queries (golden set).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { implementations } from './_impl.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./F06-nl-asset-query.golden.json', import.meta.url), 'utf8'));

for (const { name, mod } of await implementations('F06-nl-asset-query', 'nlq.js')) {
  const { parseQuery, healthScore } = mod;

  test(`[${name}] AC-F06-1 intent accuracy on the golden set is 100%`, () => {
    for (const g of GOLDEN) assert.equal(parseQuery(g.q).intent, g.intent, g.q);
  });

  test(`[${name}] AC-F06-2 assets and asset types are resolved`, () => {
    for (const g of GOLDEN) {
      const p = parseQuery(g.q);
      if (g.assets) assert.deepEqual(p.assetIds, g.assets, g.q);
      if (g.types) assert.deepEqual(p.assetTypes, g.types, g.q);
      assert.ok(p.resolvedAssets.length > 0, g.q);
    }
  });

  test(`[${name}] AC-F06-3 metrics and time windows are extracted`, () => {
    for (const g of GOLDEN) {
      const p = parseQuery(g.q);
      for (const m of g.metrics ?? []) assert.ok(p.metrics.includes(m), `${g.q} → missing ${m}`);
      if (g.window) assert.equal(p.windowSec, g.window, g.q);
    }
  });

  test(`[${name}] AC-F06-4 health score is 100 at nominal and falls with deviation`, () => {
    assert.equal(healthScore('motor', { vibration: 1.8, bearingTemp: 58, windingTemp: 82, current: 118, rpm: 1485, powerFactor: 0.87 }), 100);
    assert.ok(healthScore('motor', { vibration: 6.5, bearingTemp: 80, windingTemp: 82, current: 118, rpm: 1485, powerFactor: 0.87 }) < 50);
  });
}
