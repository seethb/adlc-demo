// Acceptance tests for F03 — automated work orders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { implementations } from './_impl.js';
import { createInventory } from '../../edge/reference/inventory.js';

const anomaly = (over = {}) => ({ id: `AN-${Math.random().toString(36).slice(2, 7)}`, ts: '2026-09-25T06:00:00.000Z', assetId: 'PMP-201', assetType: 'centrifugal_pump', severity: 'high', rule: 'limit-high', failureMode: 'cavitation', confidence: 0.9, metrics: [], ...over });

for (const { name, mod } of await implementations('F03-work-orders', 'workorders.js')) {
  const { createWorkOrderService } = mod;

  test(`[${name}] AC-F03-1 severity maps to priority; low severity raises no WO`, () => {
    const svc = createWorkOrderService({ inventory: createInventory() });
    assert.equal(svc.fromAnomaly(anomaly({ severity: 'low' })), null);
    assert.equal(svc.fromAnomaly(anomaly({ severity: 'critical', assetId: 'MTR-101', assetType: 'motor', failureMode: 'bearing_wear' })).priority, 'P1');
    assert.equal(svc.fromAnomaly(anomaly({ severity: 'high' })).priority, 'P2');
    assert.equal(svc.fromAnomaly(anomaly({ severity: 'medium', assetId: 'SHF-301', assetType: 'shaft', failureMode: 'misalignment' })).priority, 'P3');
  });

  test(`[${name}] AC-F03-2 one open WO per asset + failure mode; repeats are deduplicated`, () => {
    const svc = createWorkOrderService({ inventory: createInventory() });
    const a = svc.fromAnomaly(anomaly());
    const b = svc.fromAnomaly(anomaly());
    assert.equal(a.id, b.id);
    assert.equal(b.deduplicated, true);
    assert.equal(svc.list().length, 1);
    assert.equal(svc.list()[0].occurrences, 2);
    const c = svc.fromAnomaly(anomaly({ critical: true, severity: 'critical' }));
    assert.equal(c.priority, 'P1', 'a more severe repeat escalates priority');
  });

  test(`[${name}] AC-F03-3 WO carries playbook tasks and reserves parts in inventory`, () => {
    const inv = createInventory();
    const svc = createWorkOrderService({ inventory: inv });
    const wo = svc.fromAnomaly(anomaly());
    assert.ok(wo.tasks.length >= 2);
    assert.ok(wo.parts.some(p => p.sku === 'SEAL-M42'));
    assert.equal(inv.list().find(i => i.sku === 'SEAL-M42').reserved, 1);
  });

  test(`[${name}] AC-F03-4 closing a WO consumes its reserved parts; a new WO can then open`, () => {
    const inv = createInventory();
    const svc = createWorkOrderService({ inventory: inv });
    const wo = svc.fromAnomaly(anomaly());
    const before = inv.list().find(i => i.sku === 'SEAL-M42').onHand;
    assert.equal(svc.close(wo.id), true);
    const seal = inv.list().find(i => i.sku === 'SEAL-M42');
    assert.equal(seal.onHand, before - 1);
    assert.equal(seal.reserved, 0);
    assert.notEqual(svc.fromAnomaly(anomaly()).id, wo.id);
  });
}
