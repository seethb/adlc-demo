// F02 · Streaming anomaly detection — edge/features/F02-anomaly-detection/index.js
//
// Pure ES module, no I/O, no network, no eval. Only node: built-ins and the shared
// reference fleet definitions are imported (org standard ADR-001).
//
// IoT security standard (OWASP IoT I5): telemetry is untrusted input. Every reading
// is validated before it can touch a baseline or be scored (AC-F02-6). Unknown
// asset ids are dropped too, never scored, never stored.
//
// Architecture decision: each per-asset/per-metric baseline learns during warm-up
// and then FREEZES its spread (and stops updating) so slow drift injected by a
// fault can never be absorbed into "normal" (see F02 risks section).

import { randomUUID } from 'node:crypto';
import { FLEET, ASSET_TYPES } from '../../reference/fleet.js';

const KNOWN_ASSET_IDS = new Set(FLEET.map(a => a.id));

// ---- ISO 10816-3 vibration zones (AC-F02-2) --------------------------------
export function vibrationZone(mmS) {
  if (mmS <= 2.8) return 'A';
  if (mmS <= 4.5) return 'B';
  if (mmS <= 7.1) return 'C';
  return 'D';
}

// ---- failure-mode classification from the set of anomalous metrics (AC-F02-4) --
// Matching is done on lower-cased substrings so it stays robust to the exact
// metric-key spelling used by the reference fleet/simulator, while still
// satisfying the exact-key examples in the acceptance suite
// (classify(['surgeMargin','vibration']) -> surge, classify(['vibration']) -> imbalance).
export function classify(metricNames) {
  const names = (metricNames || []).map(m => String(m).toLowerCase());
  const has = (pat) => names.some((n) => n.includes(pat));

  if (has('surgemargin')) return { failureMode: 'surge', confidence: 0.9 };
  if (has('suctionpressure')) return { failureMode: 'cavitation', confidence: 0.9 };
  if (has('oil')) return { failureMode: 'lubrication', confidence: 0.85 };
  if (has('misalignment') || has('orbit')) {
    return { failureMode: 'misalignment', confidence: 0.85 };
  }
  if (has('bearingtemp')) return { failureMode: 'bearing_wear', confidence: 0.85 };
  if (has('windingtemp') || has('current')) {
    return { failureMode: 'winding_overheat', confidence: 0.85 };
  }
  if (has('vibration')) return { failureMode: 'imbalance', confidence: 0.6 };
  return { failureMode: 'unknown', confidence: 0.3 };
}

// ---- untrusted-input validation (AC-F02-6) --------------------------------
function isValidReading(reading) {
  if (!reading || typeof reading !== 'object') return false;
  if (typeof reading.assetId !== 'string' || !KNOWN_ASSET_IDS.has(reading.assetId)) return false;
  if (!reading.metrics || typeof reading.metrics !== 'object') return false;
  for (const v of Object.values(reading.metrics)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  return true;
}

function updateWelford(stats, value) {
  stats.n += 1;
  const delta = value - stats.mean;
  stats.mean += delta / stats.n;
  const delta2 = value - stats.mean;
  stats.m2 += delta * delta2;
}

// Look up the reference nominal sigma for an asset type/metric, used as a
// floor so that short warm-ups (or metrics that happen to be near-constant
// during warm-up) cannot yield a near-zero sigma that would make ordinary
// simulator jitter on an unrelated (healthy) asset look anomalous.
function nominalSigma(assetType, metric) {
  const t = ASSET_TYPES[assetType];
  const nom = t && t.nominal && t.nominal[metric];
  return Array.isArray(nom) ? nom[1] : null;
}

function sigmaOf(stats, floorHint) {
  let s = stats.n >= 2 ? Math.sqrt(stats.m2 / (stats.n - 1)) : 0;
  const nomFloor = floorHint != null && Number.isFinite(floorHint) ? floorHint * 0.4 : 0;
  const floor = Math.max(nomFloor, 1e-6);
  return s > floor ? s : floor;
}

function severityForMetric(metric, value, absZ) {
  if (metric === 'vibration' && vibrationZone(value) === 'D') return 'critical';
  if (absZ >= 8) return 'critical';
  if (absZ >= 6) return 'high';
  if (absZ >= 4.5) return 'medium';
  return 'low';
}

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

function makeId() {
  return `anm-${randomUUID()}`;
}

// ---- detector (AC-F02-1, AC-F02-3, AC-F02-5) ------------------------------
export function createDetector(opts = {}) {
  const warmupTicks = opts.warmupTicks ?? 30;
  const zThreshold = opts.zThreshold ?? 5.0;

  // Per-asset, per-metric Welford stats — closed over, never shared/global.
  const baselines = new Map(); // assetId -> Map(metric -> { n, mean, m2 })
  const tickCounts = new Map(); // assetId -> number of accepted readings seen

  const rejected = { count: 0, last: null };

  function observe(reading) {
    if (!isValidReading(reading)) {
      rejected.count += 1;
      rejected.last = reading;
      return [];
    }

    const { assetId, assetType, ts, metrics } = reading;

    let baseline = baselines.get(assetId);
    if (!baseline) {
      baseline = new Map();
      baselines.set(assetId, baseline);
    }

    const count = (tickCounts.get(assetId) || 0) + 1;
    tickCounts.set(assetId, count);
    const warm = count <= warmupTicks;

    const triggered = [];

    for (const [metric, value] of Object.entries(metrics)) {
      let stats = baseline.get(metric);
      if (!stats) {
        stats = { n: 0, mean: 0, m2: 0 };
        baseline.set(metric, stats);
      }

      if (warm) {
        // Learn only during warm-up; baseline freezes (stops updating) once
        // warmupTicks is reached — this is what prevents drift absorption.
        updateWelford(stats, value);
        continue;
      }

      if (stats.n < 2) continue; // never seen enough to score safely

      const floorHint = nominalSigma(assetType, metric);
      const sigma = sigmaOf(stats, floorHint);
      const z = (value - stats.mean) / sigma;
      const az = Math.abs(z);

      if (az >= zThreshold) {
        const severity = severityForMetric(metric, value, az);
        const limit = Number((stats.mean + Math.sign(z || 1) * zThreshold * sigma).toFixed(3));
        triggered.push({
          metric,
          value,
          z: Number(z.toFixed(3)),
          severity,
          rule: 'zscore',
          limit,
        });
      }
    }

    if (warm || triggered.length === 0) return [];

    const { failureMode, confidence } = classify(triggered.map((t) => t.metric));
    const severity = triggered.reduce(
      (acc, t) => (SEVERITY_ORDER.indexOf(t.severity) > SEVERITY_ORDER.indexOf(acc) ? t.severity : acc),
      'low'
    );
    const score = Number(Math.max(...triggered.map((t) => Math.abs(t.z))).toFixed(3));

    const anomaly = {
      id: makeId(),
      ts,
      assetId,
      assetType,
      severity,
      score,
      rule: 'zscore',
      failureMode,
      confidence,
      metrics: triggered,
    };

    return [anomaly];
  }

  return { observe, rejected };
}
