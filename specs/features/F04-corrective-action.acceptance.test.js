// Acceptance tests for F04 — Corrective Action Reports (8D).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { implementations } from './_impl.js';

const wo = (over = {}) => ({ id: 'WO-1001', assetId: 'PMP-201', failureMode: 'cavitation', priority: 'P2', occurrences: 1, status: 'open', tasks: ['Check NPSH'], createdAt: '2026-09-25T06:00:00Z', lastSeen: '2026-09-25T06:05:00Z', ...over });

for (const { name, mod } of await implementations('F04-corrective-action', 'car.js')) {
  const { createCarService } = mod;

  test(`[${name}] AC-F04-1 any P1 work order opens a CAR`, () => {
    const svc = createCarService();
    const cars = svc.evaluate([wo({ priority: 'P1' })]);
    assert.equal(cars.length, 1);
    assert.equal(cars[0].trigger, 'critical-failure');
  });

  test(`[${name}] AC-F04-2 recurrence opens a CAR; a single P2 does not`, () => {
    assert.equal(createCarService().evaluate([wo()]).length, 0);
    assert.equal(createCarService().evaluate([wo(), wo({ id: 'WO-1002', status: 'closed' })])[0].trigger, 'recurrence');
    assert.equal(createCarService().evaluate([wo({ occurrences: 3 })]).length, 1);
  });

  test(`[${name}] AC-F04-3 at most one CAR per asset + failure mode`, () => {
    const svc = createCarService();
    svc.evaluate([wo({ priority: 'P1' })]);
    assert.equal(svc.evaluate([wo({ priority: 'P1' }), wo({ id: 'WO-1005', priority: 'P1' })]).length, 0);
    assert.equal(svc.list().length, 1);
  });

  test(`[${name}] AC-F04-4 CAR has the 8D fields filled in`, () => {
    const [car] = createCarService().evaluate([wo({ priority: 'P1' })]);
    for (const k of ['id', 'assetId', 'failureMode', 'trigger', 'workOrders', 'status', 'd2_problem', 'd3_containment', 'd4_rootCause', 'd5_corrective', 'd7_preventive']) {
      assert.ok(car[k] !== undefined && car[k] !== '', `missing ${k}`);
    }
    assert.match(car.id, /^CAR-\d{3}$/);
    assert.deepEqual(car.workOrders, ['WO-1001']);
  });
}
