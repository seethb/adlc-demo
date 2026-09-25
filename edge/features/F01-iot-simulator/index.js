// F01 · IoT telemetry simulator
// Data classification: C2 Confidential (raw telemetry). Edge-resident only;
// this module performs no persistence/transport/egress (see design.md).
// Read-only towards OT by construction: no PLC/OPC-UA/setpoint access exists here.
// Per IoT security standard: all inputs (config, inject/clear args) are treated as
// untrusted — non-finite numbers, unknown assets, unknown/inapplicable faults throw.
//
// Org standards: pure ESM, no I/O/network, only node: built-ins + reference/fleet.js.

import { FLEET, ASSET_TYPES, FAULTS } from '../../reference/fleet.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function assertFinite(name, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`${name} must be a finite number, got ${v}`);
  }
}

function buildFleet(assets) {
  if (assets === undefined) {
    return FLEET.map(a => ({ ...a }));
  }
  if (!Array.isArray(assets)) {
    throw new TypeError('assets override must be an array');
  }
  const seen = new Set();
  const out = [];
  for (const a of assets) {
    if (!a || typeof a !== 'object') {
      throw new TypeError('each asset override entry must be an object');
    }
    if (typeof a.id !== 'string' || a.id.length === 0) {
      throw new TypeError('asset override entries require a non-empty string id');
    }
    if (seen.has(a.id)) {
      throw new TypeError(`duplicate asset id in override: ${a.id}`);
    }
    seen.add(a.id);
    if (typeof a.type !== 'string' || !(a.type in ASSET_TYPES)) {
      throw new TypeError(`asset override ${a.id} has unknown type: ${a.type}`);
    }
    out.push({ ...a });
  }
  return out;
}

function validateAsset(fleetIndex, assetId) {
  const asset = fleetIndex.get(assetId);
  if (!asset) {
    throw new RangeError(`unknown asset: ${assetId}`);
  }
  return asset;
}

function validateFault(asset, faultName) {
  const def = FAULTS[faultName];
  if (!def) {
    throw new TypeError(`unknown fault: ${faultName}`);
  }
  if (!def.appliesTo.includes(asset.type)) {
    throw new TypeError(`fault ${faultName} does not apply to asset type ${asset.type}`);
  }
  return def;
}

export function createSimulator({ seed = 0, assets, startTs = 0, stepMs = 1000 } = {}) {
  assertFinite('seed', seed);
  assertFinite('startTs', startTs);
  assertFinite('stepMs', stepMs);

  const fleet = buildFleet(assets);
  const fleetIndex = new Map(fleet.map(a => [a.id, a]));

  const rng = mulberry32(seed);
  let clockMs = startTs;
  const faultState = new Map(); // assetId -> { fault, ticksSinceInject }

  function nominalReading(typeDef) {
    const metrics = {};
    for (const [metric, [mean, sd]] of Object.entries(typeDef.nominal)) {
      let v = mean + gaussian(rng) * sd;
      const lo = mean - 4.5 * sd;
      const hi = mean + 4.5 * sd;
      if (v < lo) v = lo;
      if (v > hi) v = hi;
      if (!Number.isFinite(v)) {
        throw new RangeError(`non-finite generated metric ${metric}`);
      }
      metrics[metric] = round3(v);
    }
    return metrics;
  }

  function applyFaultProfile(typeDef, faultDef, ticks, metrics) {
    const growth = 1 - Math.exp(-ticks / 10);
    for (const [metric, fraction] of Object.entries(faultDef.effects)) {
      if (!(metric in metrics)) continue;
      const [mean] = typeDef.nominal[metric];
      const base = metrics[metric];
      const delta = mean * fraction * growth * (ticks + 1);
      let v = base + delta;
      const jitterMult = faultDef.jitter && faultDef.jitter[metric];
      if (jitterMult) {
        const [, sd] = typeDef.nominal[metric];
        v += gaussian(rng) * sd * jitterMult;
      }
      if (!Number.isFinite(v)) {
        throw new RangeError(`non-finite fault-degraded metric ${metric}`);
      }
      metrics[metric] = round3(v);
    }
    return metrics;
  }

  function tick() {
    clockMs += stepMs;
    const ts = new Date(clockMs).toISOString();
    const out = [];
    for (const asset of fleet) {
      const typeDef = ASSET_TYPES[asset.type];
      let metrics = nominalReading(typeDef);
      const state = faultState.get(asset.id);
      let faultName = null;
      if (state) {
        const faultDef = FAULTS[state.fault];
        metrics = applyFaultProfile(typeDef, faultDef, state.ticksSinceInject, metrics);
        state.ticksSinceInject += 1;
        faultName = state.fault;
      }
      out.push({
        ts,
        assetId: asset.id,
        type: asset.type,
        metrics,
        fault: faultName,
      });
    }
    return out;
  }

  function inject(assetId, faultName) {
    const asset = validateAsset(fleetIndex, assetId);
    validateFault(asset, faultName);
    faultState.set(assetId, { fault: faultName, ticksSinceInject: 0 });
  }

  function clear(assetId) {
    validateAsset(fleetIndex, assetId);
    faultState.delete(assetId);
  }

  function activeFaults() {
    const result = {};
    for (const [assetId, state] of faultState.entries()) {
      result[assetId] = state.fault;
    }
    return result;
  }

  return {
    tick,
    inject,
    clear,
    activeFaults,
    assets: fleet,
  };
}
