// edge/features/F01-iot-simulator/index.js
//
// F01 · IoT telemetry simulator (AC-F01-1..5)
//
// Data classification: output readings are C2 Confidential telemetry —
// edge-resident only (7-day ring buffer), no persistence/transport performed
// here. This module is a pure generator with no OT connection: it never
// reads or writes PLC/OPC-UA registers or setpoints (read-only-towards-OT by
// construction — org security standard, IEC 62443 zones/conduits).
//
// Inputs (createSimulator args, inject/clear calls) are treated as untrusted
// per the IoT security standard: unknown assetId / inapplicable fault names
// and non-finite config values throw synchronously (AC-F01-5).
//
// No I/O, no network, no child_process, no eval, no process.env — pure ESM
// (org standard ADR-001). Only node: built-ins and the reference fleet are
// imported.

import { FLEET, ASSET_TYPES, FAULTS } from '../../reference/fleet.js';

const MAX_SIGMA = 4.5;
const RESAMPLE_ATTEMPTS = 64;
const JITTER_GROWTH_TAU = 10; // ticks; jitter scaling saturates, never unbounded

/** mulberry32 seeded PRNG — sole source of randomness (AC-F01-2). */
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

/** Box-Muller standard normal sample using the seeded rng. */
function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

/**
 * Sample a healthy metric value. Resamples (rather than clamping) so the
 * distribution shape stays a genuine (truncated) Gaussian instead of a
 * boundary spike, while still guaranteeing the 4.5σ band (AC-F01-3).
 */
function sampleNominal(rng, mean, sigma) {
  let value = mean + gaussian(rng) * sigma;
  let attempts = 0;
  while (Math.abs(value - mean) > MAX_SIGMA * sigma && attempts < RESAMPLE_ATTEMPTS) {
    value = mean + gaussian(rng) * sigma;
    attempts += 1;
  }
  if (Math.abs(value - mean) > MAX_SIGMA * sigma) {
    // Extremely unlikely fallback: pull to the nearest edge of the band.
    value = mean + Math.sign(value - mean || 1) * MAX_SIGMA * sigma;
  }
  return value;
}

function nominalReading(rng, nominal) {
  const metrics = {};
  for (const [metric, [mean, sigma]] of Object.entries(nominal)) {
    metrics[metric] = round3(sampleNominal(rng, mean, sigma));
  }
  return metrics;
}

/**
 * Progressively degrade signature metrics for an active fault.
 *
 * `fault.effects[metric]` is a *per-tick fraction* (see reference/fleet.js):
 * each tick the metric compounds by `(1 + fraction)`, so after `ticks` ticks
 * the cumulative multiplier is `(1 + fraction) ** ticks`. This gives a
 * genuinely progressive (monotonically worsening) degradation whose
 * magnitude grows with elapsed ticks rather than saturating immediately
 * (AC-F01-4).
 */
function applyFaultProfile(rng, nominal, fault, ticks, metrics) {
  for (const [metric, fraction] of Object.entries(fault.effects ?? {})) {
    const [mean] = nominal[metric] ?? [0, 0];
    const multiplier = Math.pow(1 + fraction, ticks);
    const delta = mean * (multiplier - 1);
    if (metric in metrics) {
      metrics[metric] = round3(metrics[metric] + delta);
    }
  }
  const jitterGrowth = 1 - Math.exp(-ticks / JITTER_GROWTH_TAU);
  for (const [metric, sigmaMultiplier] of Object.entries(fault.jitter ?? {})) {
    const [, sigma] = nominal[metric] ?? [0, 0];
    const extraJitter = gaussian(rng) * sigma * sigmaMultiplier * jitterGrowth;
    if (metric in metrics) {
      metrics[metric] = round3(metrics[metric] + extraJitter);
    }
  }
  return metrics;
}

function validateAsset(fleet, assetId) {
  const asset = fleet.find((a) => a.id === assetId);
  if (!asset) {
    throw new RangeError(`unknown asset: ${assetId}`);
  }
  return asset;
}

function validateFault(asset, faultName) {
  const fault = FAULTS[faultName];
  if (!fault) {
    throw new TypeError(`unknown fault: ${faultName}`);
  }
  if (!fault.appliesTo.includes(asset.type)) {
    throw new TypeError(`fault "${faultName}" does not apply to asset type "${asset.type}"`);
  }
  return fault;
}

/**
 * createSimulator({ seed, assets?, startTs?, stepMs? })
 *   => { tick, inject, clear, activeFaults, assets }
 */
export function createSimulator({ seed = 0, assets = FLEET, startTs = 0, stepMs = 1000 } = {}) {
  if (!Number.isFinite(seed)) throw new TypeError('seed must be a finite number');
  if (!Number.isFinite(startTs)) throw new TypeError('startTs must be a finite number');
  if (!Number.isFinite(stepMs)) throw new TypeError('stepMs must be a finite number');

  const fleet = assets;
  const rng = mulberry32(seed >>> 0);
  let clockMs = startTs;

  /** @type {Map<string, { fault: string, ticks: number }>} */
  const faultState = new Map();

  function tick() {
    clockMs += stepMs;
    const ts = new Date(clockMs).toISOString();
    const readings = [];
    for (const asset of fleet) {
      const nominal = ASSET_TYPES[asset.type].nominal;
      const metrics = nominalReading(rng, nominal);
      const active = faultState.get(asset.id);
      let faultLabel = null;
      if (active) {
        active.ticks += 1;
        applyFaultProfile(rng, nominal, FAULTS[active.fault], active.ticks, metrics);
        faultLabel = active.fault;
      }
      readings.push({ ts, assetId: asset.id, type: asset.type, metrics, fault: faultLabel });
    }
    return readings;
  }

  function inject(assetId, faultName) {
    const asset = validateAsset(fleet, assetId);
    validateFault(asset, faultName);
    faultState.set(assetId, { fault: faultName, ticks: 0 });
  }

  function clear(assetId) {
    validateAsset(fleet, assetId);
    faultState.delete(assetId);
  }

  function activeFaults() {
    const out = {};
    for (const [assetId, { fault }] of faultState.entries()) {
      out[assetId] = fault;
    }
    return out;
  }

  return { tick, inject, clear, activeFaults, assets: fleet };
}
