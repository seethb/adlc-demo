// F01 · IoT telemetry simulator
//
// DATA CLASSIFICATION: C2 Confidential. Output of this module is simulated plant
// telemetry and must be treated exactly like raw OT telemetry — EDGE-RESIDENT ONLY.
// Callers must not forward Reading[] to cloud services, Claude, or Meko. This
// module is READ-ONLY TOWARDS OT: it has no actuation API, no setpoint/write path
// and performs no network or filesystem I/O — it only generates in-memory
// readings (IEC 62443 zones/conduits; org security-standard "edge analytics is
// read-only towards OT"). All metrics emitted are validated finite (assertFinite)
// before leaving this module per the IoT security standard (OWASP IoT I5):
// telemetry (even simulated) is treated as untrusted input downstream, so we
// never emit NaN/Infinity and never emit unknown asset ids or metrics.
//
// No npm dependencies, no I/O, no network, no process.env, no eval — only
// node: built-ins (none needed here) and the reference fleet definitions.

import { FLEET, ASSET_TYPES, FAULTS } from '../../reference/fleet.js';

// --- deterministic PRNG (AC-F01-2: same seed => identical stream) ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller gaussian sample, rejection-sampled to stay within clampSigma
// standard deviations of the mean (AC-F01-3: healthy readings within 4.5σ).
function gaussian(rng, mean, sigma, clampSigma = 4.5) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    if (Math.abs(z) <= clampSigma) return mean + z * sigma;
  }
  // Fallback: clamp deterministically if rejection sampling somehow failed.
  return mean;
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function assertFinite(n, where) {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new TypeError(`non-finite metric value at ${where}`);
  }
  return n;
}

function validateAssetId(assets, assetId) {
  const asset = assets.find((a) => a.id === assetId);
  if (!asset) throw new RangeError(`unknown asset: ${assetId}`);
  return asset;
}

function validateFault(assetType, fault) {
  const def = FAULTS[fault];
  if (!def) throw new RangeError(`unknown fault: ${fault}`);
  if (!def.appliesTo.includes(assetType)) {
    throw new RangeError(`fault ${fault} does not apply to asset type ${assetType}`);
  }
  return def;
}

// Progressively degrade signature metrics with age (ticks since injection).
// effects: { metric: perTickFraction } — multiplicative fractional drift per
// tick applied to the nominal mean, then jittered with an amplified sigma.
function applyFault(rng, nominal, faultDef, age) {
  const metrics = {};
  for (const [metric, [mean, sigma]] of Object.entries(nominal)) {
    const fraction = faultDef.effects?.[metric];
    const jitterMult = faultDef.jitter?.[metric] ?? 1;
    let base = mean;
    if (typeof fraction === 'number') {
      base = mean * Math.pow(1 + fraction, age);
    }
    const value = base + gaussian(rng, 0, sigma * jitterMult, Infinity);
    metrics[metric] = round3(assertFinite(value, `fault metric ${metric}`));
  }
  return metrics;
}

function healthyMetrics(rng, nominal) {
  const metrics = {};
  for (const [metric, [mean, sigma]] of Object.entries(nominal)) {
    const value = gaussian(rng, mean, sigma, 4.5);
    metrics[metric] = round3(assertFinite(value, `nominal metric ${metric}`));
  }
  return metrics;
}

export function createSimulator(config = {}) {
  const {
    seed = 1,
    assets = FLEET,
    startTs = new Date(0).toISOString(),
    stepMs = 1000,
  } = config;

  const rng = mulberry32(seed);
  let clockMs = Date.parse(startTs);
  let tickCount = 0;

  // Map<assetId, { fault, sinceTick }>
  const faults = new Map();

  function tick() {
    const currentTick = tickCount;
    const ts = new Date(clockMs).toISOString();
    const readings = [];

    for (const asset of assets) {
      const typeDef = ASSET_TYPES[asset.type];
      const entry = faults.get(asset.id);
      let metrics;
      let faultLabel = null;

      if (entry) {
        const faultDef = FAULTS[entry.fault];
        const age = currentTick - entry.sinceTick;
        metrics = applyFault(rng, typeDef.nominal, faultDef, age);
        faultLabel = entry.fault;
      } else {
        metrics = healthyMetrics(rng, typeDef.nominal);
      }

      readings.push({
        ts,
        assetId: asset.id,
        type: asset.type,
        metrics,
        fault: faultLabel,
      });
    }

    clockMs += stepMs;
    tickCount += 1;
    return readings;
  }

  function inject(assetId, fault) {
    const asset = validateAssetId(assets, assetId);
    validateFault(asset.type, fault);
    faults.set(assetId, { fault, sinceTick: tickCount });
  }

  function clear(assetId) {
    validateAssetId(assets, assetId);
    faults.delete(assetId);
  }

  function activeFaults() {
    return Array.from(faults.entries()).map(([assetId, { fault }]) => ({ assetId, fault }));
  }

  return { tick, inject, clear, activeFaults, assets };
}
