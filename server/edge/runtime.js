// Live edge runtime: runs the fleet at 1 Hz through detection → work orders →
// CARs → inventory, and streams a snapshot to the UI. It runs the reference
// build; the Edge Ops page shows which features agents have shipped to
// edge-staging through the ADLC pipeline.
import { emit, state } from '../core.js';
import { createSimulator, createDetector, createWorkOrderService, createCarService, createInventory, healthScore, FLEET, FAULTS, ASSET_TYPES, METRICS } from '../../edge/reference/index.js';

const HISTORY = 120;
let sim, det, inv, wos, cars, timer;
let history, anomalies, events, securityEvents, tickCount;

export function reset() {
  sim = createSimulator({ seed: Date.now() % 100000, startTs: Date.now() });
  det = createDetector();
  inv = createInventory();
  wos = createWorkOrderService({ inventory: inv });
  cars = createCarService();
  history = Object.fromEntries(FLEET.map(a => [a.id, []]));
  anomalies = [];
  events = [];
  securityEvents = [];
  tickCount = 0;
}

function note(kind, text, extra = {}) {
  const e = { at: new Date().toISOString(), kind, text, ...extra };
  events.unshift(e);
  events.length = Math.min(events.length, 80);
  emit('edge-event', e);
}

function step() {
  tickCount++;
  for (const r of sim.tick()) {
    const h = history[r.assetId];
    h.push({ ts: r.ts, ...r.metrics });
    if (h.length > HISTORY) h.shift();
    for (const a of det.observe(r)) {
      anomalies.unshift(a);
      anomalies.length = Math.min(anomalies.length, 200);
      const wo = wos.fromAnomaly(a);
      if (wo && !wo.deduplicated) note('work_order', `${wo.id} ${wo.priority} raised — ${wo.title}`, { id: wo.id, assetId: wo.assetId });
      if (wo?.deduplicated && wo.occurrences % 10 === 0) note('work_order', `${wo.id} seen ${wo.occurrences}× (${wo.priority})`, { id: wo.id, assetId: wo.assetId });
    }
  }
  for (const c of cars.evaluate(wos.list())) note('car', `${c.id} opened (${c.trigger}) — ${c.d2_problem}`, { id: c.id, assetId: c.assetId });
  emit('edge', snapshot(true));
}

export function start() { if (!sim) reset(); clearInterval(timer); timer = setInterval(step, 1000); }
export function stop() { clearInterval(timer); timer = null; }

export function snapshot(compact = false) {
  const faults = sim.activeFaults();
  const openAnomaly = id => anomalies.find(a => a.assetId === id && Date.parse(a.ts) > Date.parse(history[id].at(-1)?.ts ?? 0) - 5000);
  const assets = FLEET.map(a => {
    const h = history[a.id];
    const latest = h.at(-1) ?? {};
    const { ts, ...metrics } = latest;
    return {
      ...a, typeLabel: ASSET_TYPES[a.type].label, ts, metrics, health: healthScore(a.type, metrics),
      fault: faults[a.id]?.fault ?? null, faultTicks: faults[a.id]?.ticks ?? 0,
      openAnomaly: openAnomaly(a.id) ?? null,
      history: compact ? h.slice(-60) : h,
    };
  });
  return {
    tick: tickCount,
    assets,
    anomalies: anomalies.slice(0, compact ? 40 : 200),
    workOrders: wos.list().reverse(),
    cars: cars.list().reverse(),
    inventory: inv.list(),
    requisitions: inv.requisitions().reverse(),
    events: events.slice(0, 40),
    security: { rejectedReadings: det.rejected.count, lastRejected: det.rejected.last, events: securityEvents.slice(0, 20) },
    deployments: state.deployments ?? {},
    catalog: compact ? undefined : { faults: Object.fromEntries(Object.entries(FAULTS).map(([k, v]) => [k, { label: v.label, appliesTo: v.appliesTo }])), metrics: METRICS },
  };
}

export function inject(assetId, fault) { sim.inject(assetId, fault); note('fault', `Injected ${FAULTS[fault].label} on ${assetId}`, { assetId }); }
export function clear(assetId) { sim.clear(assetId); note('fault', `Cleared fault on ${assetId}`, { assetId }); }
export function closeWo(id) { const ok = wos.close(id); if (ok) note('work_order', `${id} closed — parts consumed`, { id }); return ok; }
export function receive(reqId) { const ok = inv.receive(reqId); if (ok) note('inventory', `${reqId} received into stores`, { id: reqId }); return ok; }

// Security demo: a spoofed or corrupted reading is rejected by the detector's
// input validation (AC-F02-6) instead of opening work orders.
export function tamper(assetId) {
  const last = history[assetId].at(-1);
  const { ts, ...metrics } = last;
  const bad = { ts: new Date().toISOString(), assetId, type: FLEET.find(a => a.id === assetId).type, metrics: { ...metrics, vibration: NaN, bearingTemp: Infinity }, fault: null };
  const out = det.observe(bad);
  const e = { at: new Date().toISOString(), assetId, text: `Rejected tampered reading from ${assetId} (NaN/Infinity) — no anomaly, no work order`, raised: out.length };
  securityEvents.unshift(e);
  note('security', e.text, { assetId });
  return e;
}

export const fleetMeta = () => ({ fleet: FLEET, faults: FAULTS, types: ASSET_TYPES, metrics: METRICS });
