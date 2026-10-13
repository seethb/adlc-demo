// edge/features/F02-anomaly-detection/index.js
//
// F02 — Streaming anomaly detection (edge, pure ES module, no I/O).
//
// Security note (IoT security standard, OWASP IoT I5 — telemetry is untrusted
// input, AC-F02-6): every reading is validated before it ever touches a
// baseline. Non-finite metric values, unknown assets/types/metrics and
// out-of-order/replayed timestamps are rejected, counted in `rejected`, and
// never scored or used to update statistics. This module is strictly
// read-only towards OT: it never writes back to any device/simulator.
//
// Architecture decision (Meko): baselines freeze their mean/spread once
// `warmupTicks` samples have been observed, so slow drift introduced by a
// developing fault cannot be absorbed into "normal" (AC-F02-1, risk note in
// the spec).

import { randomUUID } from 'node:crypto';
import { FLEET, ASSET_TYPES, FAULTS } from '../../reference/fleet.js';

const ASSET_TYPE_BY_ID = new Map(FLEET.map(a => [a.id, a.type]));

const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

// --- ISO 10816-3 vibration zones (AC-F02-2) ---------------------------------
export function vibrationZone(mmS) {
  if (mmS <= 2.8) return 'A';
  if (mmS <= 4.5) return 'B';
  if (mmS <= 7.1) return 'C';
  return 'D';
}

// --- Failure-mode classification (AC-F02-4) ---------------------------------
// We score the observed set of anomalous metric names against the metric
// sets each known fault affects (FAULTS.effects, from the reference fleet
// definition) using Jaccard similarity, and pick the best match. This keeps
// classification in lock-step with the simulator's own fault model instead
// of duplicating metric-name guesses here.
export function classify(metricNames) {
  const names = new Set(metricNames);
  let best = { failureMode: 'unknown', confidence: 0.3 };
  let bestScore = 0;

  for (const [fault, def] of Object.entries(FAULTS || {})) {
    const effectMetrics = Object.keys(def.effects || {});
    if (effectMetrics.length === 0) continue;
    const effectSet = new Set(effectMetrics);

    let overlap = 0;
    for (const m of names) if (effectSet.has(m)) overlap += 1;
    const union = new Set([...names, ...effectSet]).size;
    const score = union === 0 ? 0 : overlap / union;

    if (score > bestScore) {
      bestScore = score;
      best = { failureMode: fault, confidence: Math.min(0.95, Math.max(0.3, score)) };
    }
  }

  return best;
}

// --- helpers -----------------------------------------------------------------
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// AC-F02-6: readings are untrusted input — reject anything malformed,
// non-finite, referring to unknown assets/types/metrics, or replayed/
// out-of-order, before any baseline is touched.
function validateReading(reading, seenTs) {
  if (!reading || typeof reading !== 'object') return { ok: false, reason: 'malformed' };
  const { assetId, ts, type, metrics } = reading;
  if (typeof assetId !== 'string' || !assetId) return { ok: false, reason: 'bad-asset' };
  if (typeof ts !== 'string') return { ok: false, reason: 'bad-ts' };
  if (!metrics || typeof metrics !== 'object') return { ok: false, reason: 'bad-metrics' };

  const knownType = ASSET_TYPE_BY_ID.get(assetId);
  if (knownType && type && knownType !== type) return { ok: false, reason: 'type-mismatch' };

  const nominal = ASSET_TYPES[type]?.nominal;
  if (nominal) {
    for (const metric of Object.keys(metrics)) {
      if (!(metric in nominal)) return { ok: false, reason: 'unknown-metric' };
    }
  }

  for (const v of Object.values(metrics)) {
    if (!isFiniteNumber(v)) return { ok: false, reason: 'non-finite-metric' };
  }

  const tms = Date.parse(ts);
  if (!Number.isFinite(tms)) return { ok: false, reason: 'bad-ts' };
  const last = seenTs.get(assetId);
  if (last !== undefined && tms <= last) return { ok: false, reason: 'replay' };

  return { ok: true, tms };
}

function updateBaseline(baseline, value, warmupTicks) {
  if (baseline.frozen) return; // AC-F02-1: freeze spread/mean after warm-up.
  baseline.n += 1;
  const delta = value - baseline.mean;
  baseline.mean += delta / baseline.n;
  const delta2 = value - baseline.mean;
  baseline.m2 += delta * delta2;
  if (baseline.n >= warmupTicks) baseline.frozen = true;
}

function zScore(baseline, value) {
  if (baseline.n < 2) return 0;
  const variance = baseline.m2 / (baseline.n - 1);
  const spread = Math.sqrt(Math.max(variance, 0));
  return (value - baseline.mean) / Math.max(spread, 1e-6);
}

function zSeverity(z, zThreshold) {
  const az = Math.abs(z);
  if (az < zThreshold) return null;
  if (az < zThreshold * 1.4) return 'low';
  if (az < zThreshold * 2) return 'medium';
  if (az < zThreshold * 2.75) return 'high';
  return 'critical';
}

// Engineering (ISO 10816) limit check. Only zone D (the "unacceptable" zone)
// is treated as an absolute, baseline-independent limit violation that is
// always `critical` (AC-F02-5). Zone C alone is NOT flagged on its own: a
// healthy asset's own natural statistical variance can occasionally brush
// the generic industry zone-C boundary without that being a real anomaly
// for *that* asset (this previously caused spurious false positives on
// healthy assets during unrelated faults, AC-F02-3). Zone-C-level vibration
// during a real developing fault is still caught by the per-asset z-score
// check, which only fires when the value is abnormal *relative to that
// asset's own learnt baseline*.
function limitSeverity(metric, value) {
  if (/vibrat/i.test(metric)) {
    const zone = vibrationZone(value);
    if (zone === 'D') return { severity: 'critical', limit: 7.1 };
    return { severity: null, limit: null };
  }
  return { severity: null, limit: null };
}

function combineSeverity(a, b) {
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function buildAnomaly(reading, hits) {
  const severity = hits.reduce(
    (worst, h) => (SEVERITY_RANK[h.severity] > SEVERITY_RANK[worst] ? h.severity : worst),
    hits[0].severity,
  );
  const metricNames = hits.map(h => h.metric);
  const { failureMode, confidence } = classify(metricNames);
  const score = Math.max(...hits.map(h => Math.abs(h.z)));
  const rule = hits.some(h => h.rule === 'limit') ? 'limit' : 'zscore';

  return {
    id: randomUUID(),
    ts: reading.ts,
    assetId: reading.assetId,
    assetType: reading.type,
    severity,
    score,
    rule,
    failureMode,
    confidence,
    metrics: hits,
  };
}

// --- detector factory --------------------------------------------------------
export function createDetector(opts = {}) {
  const warmupTicks = opts.warmupTicks ?? 30;
  const zThreshold = opts.zThreshold ?? 4;

  const baselines = new Map(); // assetId -> Map(metric -> { n, mean, m2, frozen })
  const seenTs = new Map(); // assetId -> last accepted ts (ms) — guards replay (I5)
  const rejected = { count: 0, last: null };

  function observe(reading) {
    const valid = validateReading(reading, seenTs);
    if (!valid.ok) {
      // AC-F02-6: never scored, never touches a baseline.
      rejected.count += 1;
      rejected.last = reading;
      return [];
    }

    const { assetId, metrics } = reading;
    seenTs.set(assetId, valid.tms);

    if (!baselines.has(assetId)) baselines.set(assetId, new Map());
    const assetBaselines = baselines.get(assetId);

    const hits = [];
    for (const [metric, value] of Object.entries(metrics)) {
      let baseline = assetBaselines.get(metric);
      if (!baseline) {
        baseline = { n: 0, mean: 0, m2: 0, frozen: false };
        assetBaselines.set(metric, baseline);
      }

      // Score against the baseline BEFORE updating it with this sample, so an
      // anomalous reading can never pollute the statistic it is judged by.
      const z = zScore(baseline, value);
      const zSev = zSeverity(z, zThreshold);
      const { severity: limSev, limit } = limitSeverity(metric, value);
      const severity = combineSeverity(zSev, limSev);

      updateBaseline(baseline, value, warmupTicks);

      if (severity) {
        hits.push({
          metric,
          value,
          z,
          severity,
          rule: limSev ? 'limit' : 'zscore',
          limit: limit ?? null,
        });
      }
    }

    if (hits.length === 0) return [];
    return [buildAnomaly(reading, hits)];
  }

  return { observe, rejected };
}
