// Behavioural evals — feature-level scenario checks beyond the unit ACs.
// Runs in its own process (the orchestrator spawns it with a timeout) so a
// faulty agent-built module cannot hang the Studio.
//   node scripts/behavioural.js F02 edge/features/F02-anomaly-detection/index.js
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSimulator } from '../edge/reference/simulator.js';
import { createDetector } from '../edge/reference/anomaly.js';
import { createInventory, PARTS } from '../edge/reference/inventory.js';
import { createWorkOrderService } from '../edge/reference/workorders.js';
import { FLEET, ASSET_TYPES } from '../edge/reference/fleet.js';
import { readFileSync } from 'node:fs';

const GOLDEN = JSON.parse(readFileSync(new URL('../specs/features/F06-nl-asset-query.golden.json', import.meta.url), 'utf8'));
const [featureId, modulePath] = process.argv.slice(2);
const mod = await import(pathToFileURL(path.resolve(modulePath)).href);

const SCENARIO = [['MTR-101', 'bearing_wear'], ['PMP-202', 'cavitation'], ['SHF-301', 'misalignment'], ['CMP-401', 'surge'], ['GBX-601', 'lubrication'], ['MTR-102', 'winding_overheat']];

const evals = {
  F01() {
    const sim = mod.createSimulator({ seed: 21 });
    let out = 0, n = 0;
    for (let i = 0; i < 200; i++) for (const r of sim.tick()) for (const [m, [mean, sd]] of Object.entries(ASSET_TYPES[r.type].nominal)) { n++; if (Math.abs(r.metrics[m] - mean) > 4.5 * sd) out++; }
    return { score: out === 0 ? 1 : 0, metrics: { samples: n, outOfBand: out }, detail: `${n} samples, ${out} outside the 4.5σ band` };
  },
  F02() {
    let tp = 0, fp = 0, detected = 0;
    SCENARIO.forEach(([asset, fault], i) => {
      const sim = createSimulator({ seed: 100 + i });
      const det = mod.createDetector();
      for (let t = 0; t < 40; t++) sim.tick().forEach(r => det.observe(r));
      sim.inject(asset, fault);
      let hit = false;
      for (let t = 0; t < 30; t++) for (const r of sim.tick()) for (const a of det.observe(r)) { if (a.assetId === asset) { tp++; hit = true; } else fp++; }
      if (hit) detected++;
    });
    const precision = tp + fp ? tp / (tp + fp) : 0, recall = detected / SCENARIO.length;
    return { score: precision >= 0.9 && recall >= 0.9 ? 1 : Math.min(precision, recall), metrics: { precision: +precision.toFixed(3), recall: +recall.toFixed(3), tp, fp }, detail: `precision ${precision.toFixed(2)} · recall ${recall.toFixed(2)} over ${SCENARIO.length} faults` };
  },
  F03() {
    const sim = createSimulator({ seed: 7 });
    const det = createDetector();
    const wos = mod.createWorkOrderService({ inventory: createInventory() });
    for (let t = 0; t < 40; t++) sim.tick().forEach(r => det.observe(r));
    SCENARIO.slice(0, 4).forEach(([a, f]) => sim.inject(a, f));
    for (let t = 0; t < 45; t++) sim.tick().forEach(r => det.observe(r).forEach(an => wos.fromAnomaly(an)));
    const open = wos.list().filter(w => w.status !== 'closed');
    const keys = open.map(w => `${w.assetId}|${w.failureMode}`);
    const dup = keys.length - new Set(keys).size;
    const faulted = new Set(SCENARIO.slice(0, 4).map(([a]) => a));
    const covered = [...faulted].filter(a => open.some(w => w.assetId === a)).length;
    const stray = open.filter(w => !faulted.has(w.assetId)).length;
    const ok = dup === 0 && covered === faulted.size && stray === 0;
    return { score: ok ? 1 : 0, metrics: { workOrders: open.length, duplicates: dup, faultedCovered: covered, stray }, detail: `${open.length} WO(s) for ${faulted.size} faulted assets · ${dup} duplicates · ${stray} stray` };
  },
  F04() {
    const svc = mod.createCarService();
    const base = { status: 'open', tasks: ['x'], createdAt: '2026-09-25T06:00:00Z', lastSeen: '2026-09-25T06:01:00Z', occurrences: 1 };
    svc.evaluate([
      { ...base, id: 'WO-1', assetId: 'CMP-401', failureMode: 'surge', priority: 'P1' },
      { ...base, id: 'WO-2', assetId: 'PMP-201', failureMode: 'cavitation', priority: 'P2' },
      { ...base, id: 'WO-3', assetId: 'PMP-201', failureMode: 'cavitation', priority: 'P2', status: 'closed' },
      { ...base, id: 'WO-4', assetId: 'MTR-101', failureMode: 'imbalance', priority: 'P3' },
    ]);
    const n = svc.list().length;
    return { score: n === 2 ? 1 : 0, metrics: { cars: n }, detail: `${n} CAR(s) opened — expected 2 (one critical, one recurrence)` };
  },
  F05() {
    const inv = mod.createInventory(PARTS);
    let seed = 9, negative = 0;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 500; i++) {
      const sku = PARTS[Math.floor(rnd() * PARTS.length)].sku, ref = `WO-${Math.floor(rnd() * 40)}`, op = rnd();
      if (op < 0.5) inv.reserve(sku, 1 + Math.floor(rnd() * 3), ref); else if (op < 0.75) inv.release(ref); else inv.consume(ref);
      if (inv.list().some(p => p.available < 0 || p.onHand < 0)) negative++;
    }
    const openDup = Object.values(inv.requisitions().filter(r => r.status === 'open').reduce((m, r) => ({ ...m, [r.sku]: (m[r.sku] ?? 0) + 1 }), {})).filter(c => c > 1).length;
    return { score: negative === 0 && openDup === 0 ? 1 : 0, metrics: { operations: 500, negativeStates: negative, duplicateRequisitions: openDup }, detail: `500 random operations · ${negative} negative states · ${openDup} duplicate requisitions` };
  },
  F06() {
    const ok = GOLDEN.filter(g => mod.parseQuery(g.q).intent === g.intent).length;
    return { score: ok / GOLDEN.length, metrics: { golden: GOLDEN.length, correct: ok }, detail: `intent accuracy ${ok}/${GOLDEN.length} on the golden set` };
  },
};

try {
  console.log(JSON.stringify(evals[featureId]()));
} catch (e) {
  console.log(JSON.stringify({ score: 0, metrics: {}, detail: `eval crashed: ${e.message}` }));
}
