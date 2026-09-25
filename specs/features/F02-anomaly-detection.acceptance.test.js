// Acceptance tests for F02 — streaming anomaly detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { implementations } from './_impl.js';
import { createSimulator } from '../../edge/reference/simulator.js';

for (const { name, mod } of await implementations('F02-anomaly-detection', 'anomaly.js')) {
  const { createDetector, vibrationZone, classify } = mod;

  const run = (fault, assetId, ticks = 60, seed = 5) => {
    const sim = createSimulator({ seed });
    const det = createDetector();
    for (let i = 0; i < 40; i++) sim.tick().forEach(r => det.observe(r)); // warm-up on healthy data
    if (fault) sim.inject(assetId, fault);
    const found = [];
    for (let i = 0; i < ticks; i++) sim.tick().forEach(r => found.push(...det.observe(r)));
    return found;
  };

  test(`[${name}] AC-F02-1 no anomalies on a healthy fleet after warm-up (false-positive rate < 1%)`, () => {
    const found = run(null, null, 300);
    assert.ok(found.length / (300 * 8) < 0.01, `${found.length} false positives`);
  });

  test(`[${name}] AC-F02-2 ISO 10816 zones: A ≤ 2.8 < B ≤ 4.5 < C ≤ 7.1 < D`, () => {
    assert.equal(vibrationZone(2.8), 'A');
    assert.equal(vibrationZone(3.0), 'B');
    assert.equal(vibrationZone(4.6), 'C');
    assert.equal(vibrationZone(7.2), 'D');
  });

  test(`[${name}] AC-F02-3 each injected fault is detected on the right asset within 30 ticks`, () => {
    for (const [asset, fault] of [['MTR-101', 'bearing_wear'], ['PMP-202', 'cavitation'], ['SHF-301', 'misalignment'], ['CMP-401', 'surge'], ['GBX-601', 'lubrication'], ['MTR-102', 'winding_overheat']]) {
      const found = run(fault, asset, 30);
      assert.ok(found.some(a => a.assetId === asset), `${fault} on ${asset} not detected`);
      assert.ok(found.every(a => a.assetId === asset), `anomaly raised on a healthy asset during ${fault}`);
    }
  });

  test(`[${name}] AC-F02-4 anomalies carry a failure mode matching the injected fault`, () => {
    for (const [asset, fault] of [['PMP-201', 'cavitation'], ['SHF-302', 'misalignment'], ['CMP-401', 'surge'], ['GBX-601', 'lubrication']]) {
      const found = run(fault, asset, 40);
      const modes = found.map(a => a.failureMode);
      const share = modes.filter(m => m === fault).length / modes.length;
      assert.ok(share >= 0.6, `${fault}: only ${(share * 100).toFixed(0)}% classified correctly (${[...new Set(modes)]})`);
    }
    assert.equal(classify(['surgeMargin', 'vibration']).failureMode, 'surge');
    assert.equal(classify(['vibration']).failureMode, 'imbalance');
  });

  test(`[${name}] AC-F02-5 anomaly shape and severity escalate with degradation`, () => {
    const found = run('imbalance', 'MTR-101', 60);
    for (const a of found) {
      for (const k of ['id', 'ts', 'assetId', 'assetType', 'severity', 'failureMode', 'confidence', 'metrics']) assert.ok(k in a, `missing ${k}`);
      assert.ok(['low', 'medium', 'high', 'critical'].includes(a.severity));
    }
    assert.equal(found.at(-1).severity, 'critical', 'zone D vibration must be critical');
  });

  test(`[${name}] AC-F02-6 non-finite telemetry is rejected and does not corrupt baselines`, () => {
    const sim = createSimulator({ seed: 5 });
    const det = createDetector();
    for (let i = 0; i < 40; i++) sim.tick().forEach(r => det.observe(r));
    const good = sim.tick().find(r => r.assetId === 'MTR-101');
    for (const bad of [NaN, Infinity, -Infinity, '12']) {
      assert.deepEqual(det.observe({ ...good, metrics: { ...good.metrics, vibration: bad } }), []);
    }
    assert.equal(det.rejected.count, 4);
    assert.deepEqual(det.observe(good), [], 'a normal reading after rejects is still normal');
  });
}
