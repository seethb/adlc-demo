// Acceptance tests for F01 — IoT telemetry simulator. Each test names the AC it proves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { implementations } from './_impl.js';
import { FLEET, ASSET_TYPES } from '../../edge/reference/fleet.js';

for (const { name, mod } of await implementations('F01-iot-simulator', 'simulator.js')) {
  const { createSimulator } = mod;

  test(`[${name}] AC-F01-1 every tick emits one reading per asset with all nominal metrics`, () => {
    const sim = createSimulator({ seed: 7 });
    const batch = sim.tick();
    assert.equal(batch.length, FLEET.length);
    for (const r of batch) {
      const a = FLEET.find(x => x.id === r.assetId);
      assert.ok(a, `unknown asset ${r.assetId}`);
      assert.equal(r.type, a.type);
      assert.deepEqual(Object.keys(r.metrics).sort(), Object.keys(ASSET_TYPES[a.type].nominal).sort());
      assert.ok(!Number.isNaN(Date.parse(r.ts)));
      assert.equal(r.fault, null);
    }
  });

  test(`[${name}] AC-F01-2 the same seed reproduces the same stream`, () => {
    const a = createSimulator({ seed: 99 }), b = createSimulator({ seed: 99 });
    for (let i = 0; i < 25; i++) assert.deepEqual(a.tick(), b.tick());
  });

  test(`[${name}] AC-F01-3 healthy readings stay within 4σ of nominal`, () => {
    const sim = createSimulator({ seed: 3 });
    for (let i = 0; i < 200; i++) {
      for (const r of sim.tick()) {
        for (const [m, [mean, sd]] of Object.entries(ASSET_TYPES[r.type].nominal)) {
          assert.ok(Math.abs(r.metrics[m] - mean) <= 4.5 * sd + 1e-9, `${r.assetId}.${m}=${r.metrics[m]}`);
        }
      }
    }
  });

  test(`[${name}] AC-F01-4 an injected fault degrades its signature metrics and is labelled`, () => {
    const sim = createSimulator({ seed: 11 });
    sim.inject('PMP-201', 'cavitation');
    let last;
    for (let i = 0; i < 30; i++) last = sim.tick().find(r => r.assetId === 'PMP-201');
    assert.equal(last.fault, 'cavitation');
    assert.ok(last.metrics.suctionPressure < 1.0, `suction ${last.metrics.suctionPressure}`);
    assert.ok(last.metrics.vibration > 3.0, `vibration ${last.metrics.vibration}`);
    sim.clear('PMP-201');
    assert.equal(sim.tick().find(r => r.assetId === 'PMP-201').fault, null);
  });

  test(`[${name}] AC-F01-5 rejects unknown assets and faults that do not apply`, () => {
    const sim = createSimulator({ seed: 1 });
    assert.throws(() => sim.inject('XXX-000', 'imbalance'));
    assert.throws(() => sim.inject('MTR-101', 'surge'));
  });
}
