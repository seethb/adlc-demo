// F01 — IoT telemetry simulator
// Pure ES module, no I/O, no network, no npm deps (ADR-001, ADR-002).
import { FLEET, ASSET_TYPES, FAULTS } from '../../reference/fleet.js';

// Deterministic seeded PRNG (mulberry32) — required for AC-F01-2 (identical
// seed ⇒ identical stream). No Math.random / Date.now anywhere in this module.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller standard normal sample driven entirely by the seeded rng.
function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function hashSeed(seedInput) {
  if (typeof seedInput === 'number' && Number.isFinite(seedInput)) return seedInput >>> 0;
  const s = String(seedInput ?? 0);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// AC-F01-5: throws for unknown asset ids.
function validateAsset(fleet, assetId) {
  const asset = fleet.find((a) => a.id === assetId);
  if (!asset) throw new RangeError(`unknown asset: ${assetId}`);
  return asset;
}

// AC-F01-5: throws for faults that do not apply to the asset's type.
function validateFault(asset, fault) {
  const def = FAULTS[fault];
  if (!def) throw new TypeError(`unknown fault: ${fault}`);
  if (!def.appliesTo.includes(asset.type)) {
    throw new TypeError(`fault ${fault} does not apply to asset type ${asset.type}`);
  }
  return def;
}

// AC-F01-1 / AC-F01-3: sample every nominal metric within N(mean, sigma),
// clamped to ±4.5σ so healthy readings never exceed the tolerated band.
function nominalReading(rng, nominal) {
  const metrics = {};
  for (const [metric, [mean, sigma]] of Object.entries(nominal)) {
    let sample = mean + gaussian(rng) * sigma;
    const lo = mean - 4.5 * sigma;
    const hi = mean + 4.5 * sigma;
    if (sample < lo) sample = lo;
    if (sample > hi) sample = hi;
    metrics[metric] = round3(sample);
  }
  return metrics;
}

// AC-F01-4: progressively degrades the fault's signature metrics as
// `ticks` (time since injection) grows; noise still applied via jitter.
function applyFaultProfile(rng, nominal, faultDef, ticks, metrics) {
  for (const [metric, fraction] of Object.entries(faultDef.effects)) {
    const [mean, sigma] = nominal[metric];
    const jitterMult = faultDef.jitter && faultDef.jitter[metric] != null ? faultDef.jitter[metric] : 1;
    const noise = gaussian(rng) * sigma * jitterMult;
    const degraded = mean * (1 + fraction * ticks) + noise;
    metrics[metric] = round3(degraded);
  }
  return metrics;
}

export function createSimulator({ seed = 0, assets, startTs = 0, stepMs = 1000 } = {}) {
  if (!Number.isFinite(startTs)) throw new TypeError('startTs must be a finite number');
  if (!Number.isFinite(stepMs) || stepMs <= 0) throw new TypeError('stepMs must be a positive finite number');

  const fleet = (assets && assets.length ? assets : FLEET).map((a) => ({ ...a }));
  const rng = mulberry32(hashSeed(seed));
  let clockMs = startTs;

  // Map<assetId, { fault, ticksSinceInject }>
  const faultState = new Map();

  function tick() {
    // AC-F01-1: exactly one reading per asset, all nominal metrics present.
    clockMs += stepMs;
    const ts = new Date(clockMs).toISOString();
    const readings = [];
    for (const asset of fleet) {
      const typeDef = ASSET_TYPES[asset.type];
      const metrics = nominalReading(rng, typeDef.nominal);
      let fault = null;

      const state = faultState.get(asset.id);
      if (state) {
        state.ticksSinceInject += 1;
        const faultDef = FAULTS[state.fault];
        applyFaultProfile(rng, typeDef.nominal, faultDef, state.ticksSinceInject, metrics);
        fault = state.fault;
      }

      readings.push({ ts, assetId: asset.id, type: asset.type, metrics, fault });
    }
    return readings;
  }

  function inject(assetId, fault) {
    const asset = validateAsset(fleet, assetId); // AC-F01-5
    validateFault(asset, fault); // AC-F01-5
    faultState.set(assetId, { fault, ticksSinceInject: 0 });
  }

  function clear(assetId) {
    validateAsset(fleet, assetId); // AC-F01-5
    faultState.delete(assetId);
  }

  function activeFaults() {
    const out = {};
    for (const [assetId, { fault }] of faultState.entries()) out[assetId] = fault;
    return out;
  }

  return {
    tick,
    inject,
    clear,
    activeFaults,
    assets: fleet.map((a) => ({ id: a.id, type: a.type })),
  };
}
