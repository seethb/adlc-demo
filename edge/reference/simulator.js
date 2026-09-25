// F01 — IoT telemetry simulator (reference implementation).
// Spec: specs/features/F01-iot-simulator.spec.md
// Deterministic for a given seed (AC-F01-2), so evals are reproducible.
import { FLEET, ASSET_TYPES, FAULTS } from './fleet.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box–Muller on the seeded uniform source.
function gauss(rand) {
  const u = Math.max(rand(), 1e-12), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

export function createSimulator({ seed = 42, assets = FLEET, startTs = Date.UTC(2026, 8, 25, 6, 0, 0), stepMs = 1000 } = {}) {
  const rand = mulberry32(seed);
  const active = new Map(); // assetId -> { fault, ticks }
  let ts = startTs;

  function inject(assetId, fault) {
    const asset = assets.find(a => a.id === assetId);
    if (!asset) throw new Error(`unknown asset ${assetId}`);
    const f = FAULTS[fault];
    if (!f) throw new Error(`unknown fault ${fault}`);
    if (!f.appliesTo.includes(asset.type)) throw new Error(`${fault} does not apply to ${asset.type}`);
    active.set(assetId, { fault, ticks: 0 });
  }

  const clear = assetId => active.delete(assetId);

  function tick() {
    ts += stepMs;
    return assets.map(asset => {
      const nominal = ASSET_TYPES[asset.type].nominal;
      const state = active.get(asset.id);
      const f = state && FAULTS[state.fault];
      if (state) state.ticks += 1;
      const metrics = {};
      for (const [m, [mean, sigma]] of Object.entries(nominal)) {
        let value = mean + gauss(rand) * sigma;
        if (f?.effects[m] !== undefined) {
          // Progressive degradation, bounded so values stay physical.
          const k = Math.max(0.05, Math.min(5, 1 + f.effects[m] * state.ticks));
          value = mean * k + gauss(rand) * sigma;
        }
        if (f?.jitter?.[m]) value += gauss(rand) * sigma * f.jitter[m];
        metrics[m] = round(value);
      }
      return { ts: new Date(ts).toISOString(), assetId: asset.id, type: asset.type, metrics, fault: state?.fault ?? null };
    });
  }

  return {
    tick,
    inject,
    clear,
    activeFaults: () => Object.fromEntries([...active].map(([k, v]) => [k, { ...v }])),
    assets,
  };
}
