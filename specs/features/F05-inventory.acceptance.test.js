// Acceptance tests for F05 — spare-parts inventory tracking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { implementations } from './_impl.js';

const PARTS = [
  { sku: 'A', name: 'Part A', onHand: 5, reorderPoint: 2, reorderQty: 5, leadTimeDays: 3, unitCost: 10 },
  { sku: 'B', name: 'Part B', onHand: 1, reorderPoint: 1, reorderQty: 2, leadTimeDays: 9, unitCost: 99 },
];

for (const { name, mod } of await implementations('F05-inventory', 'inventory.js')) {
  const { createInventory } = mod;

  test(`[${name}] AC-F05-1 reservations never drive availability negative; shortfall is reported`, () => {
    const inv = createInventory(PARTS);
    const r = inv.reserve('A', 7, 'WO-1');
    assert.equal(r.ok, false);
    assert.equal(r.reserved, 5);
    assert.equal(r.shortfall, 2);
    assert.equal(inv.available('A'), 0);
  });

  test(`[${name}] AC-F05-2 release returns stock; consume reduces on-hand`, () => {
    const inv = createInventory(PARTS);
    inv.reserve('A', 2, 'WO-1');
    inv.release('WO-1');
    assert.equal(inv.available('A'), 5);
    inv.reserve('A', 2, 'WO-2');
    inv.consume('WO-2');
    const a = inv.list().find(i => i.sku === 'A');
    assert.equal(a.onHand, 3);
    assert.equal(a.reserved, 0);
  });

  test(`[${name}] AC-F05-3 one open requisition per SKU when at or below reorder point`, () => {
    const inv = createInventory(PARTS);
    inv.reserve('A', 3, 'WO-1');
    inv.reserve('A', 1, 'WO-2');
    const reqs = inv.requisitions().filter(r => r.sku === 'A' && r.status === 'open');
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].qty, 5);
    assert.ok(inv.lowStock().some(i => i.sku === 'A'));
  });

  test(`[${name}] AC-F05-4 receiving a requisition restocks and closes it`, () => {
    const inv = createInventory(PARTS);
    inv.reserve('B', 1, 'WO-1');
    const [req] = inv.requisitions();
    assert.equal(inv.receive(req.id), true);
    assert.equal(inv.list().find(i => i.sku === 'B').onHand, 3);
    assert.equal(inv.requisitions()[0].status, 'received');
  });

  test(`[${name}] AC-F05-5 unknown SKUs throw`, () => {
    assert.throws(() => createInventory(PARTS).reserve('ZZZ', 1, 'WO-1'));
  });
}
