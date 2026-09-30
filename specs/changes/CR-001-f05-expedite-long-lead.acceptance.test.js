// Acceptance tests for CR-001 — expedite long-lead critical spares (F05).
// Authored by the QA lead (Quill's owner) and immutable to feature agents.
// Runs against the candidate the change-request lane is gating (ADLC_IMPL),
// otherwise against the shipped F05 build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const file = process.env.ADLC_IMPL ? path.resolve(process.env.ADLC_IMPL) : path.join(root, 'edge/features/F05-inventory/index.js');
const { createInventory } = await import(pathToFileURL(file).href);

const PARTS = [
  { sku: 'STD', name: 'Standard part', onHand: 6, reorderPoint: 2, reorderQty: 4, leadTimeDays: 5, unitCost: 10 },
  { sku: 'LNG', name: 'Long-lead part', onHand: 6, reorderPoint: 2, reorderQty: 2, leadTimeDays: 21, unitCost: 900 },
  { sku: 'LOW', name: 'Long-lead part already short', onHand: 1, reorderPoint: 1, reorderQty: 1, leadTimeDays: 30, unitCost: 3200 },
];
const open = (inv, sku) => inv.requisitions().filter(r => r.sku === sku && r.status === 'open');

test('AC-CR001-1 long-lead parts reorder one unit early; others at the reorder point', () => {
  const inv = createInventory(PARTS);
  inv.reserve('LNG', 3, 'WO-1'); // available 3 = reorderPoint + 1
  assert.equal(open(inv, 'LNG').length, 1);
  inv.reserve('STD', 3, 'WO-2'); // available 3 > reorderPoint 2
  assert.equal(open(inv, 'STD').length, 0);
  inv.reserve('STD', 1, 'WO-3'); // available 2 = reorderPoint
  assert.equal(open(inv, 'STD').length, 1);
});

test('AC-CR001-2 requisitions carry priority, etaDays and reason', () => {
  const inv = createInventory(PARTS);
  inv.reserve('LNG', 3, 'WO-1');
  inv.reserve('STD', 4, 'WO-2');
  const [l] = open(inv, 'LNG');
  const [s] = open(inv, 'STD');
  assert.equal(l.priority, 'expedite');
  assert.equal(l.etaDays, 11);
  assert.equal(l.qty, 2);
  assert.equal(s.priority, 'normal');
  assert.equal(s.etaDays, 5);
  assert.equal(s.qty, 4);
  assert.ok(typeof l.reason === 'string' && l.reason.length > 0, 'reason is required');
});

test('AC-CR001-3 parts already at or below threshold get one requisition on creation', () => {
  const inv = createInventory(PARTS);
  const low = open(inv, 'LOW');
  assert.equal(low.length, 1);
  assert.equal(low[0].priority, 'expedite');
  assert.equal(low[0].etaDays, 15);
  assert.equal(open(inv, 'STD').length, 0);
  assert.equal(open(inv, 'LNG').length, 0);
  inv.reserve('LOW', 1, 'WO-9');
  assert.equal(open(inv, 'LOW').length, 1);
});

test('AC-CR001-4 list() exposes the part-master fields the edge UI shows', () => {
  const inv = createInventory(PARTS);
  const lng = inv.list().find(i => i.sku === 'LNG');
  for (const k of ['sku', 'name', 'onHand', 'reserved', 'available', 'reorderPoint', 'leadTimeDays', 'low']) assert.ok(k in lng, `list() item is missing ${k}`);
  assert.equal(lng.name, 'Long-lead part');
  assert.equal(lng.low, false);
  inv.reserve('LNG', 3, 'WO-1');
  assert.equal(inv.list().find(i => i.sku === 'LNG').low, true);
  assert.ok(inv.lowStock().some(i => i.sku === 'LOW'));
});
