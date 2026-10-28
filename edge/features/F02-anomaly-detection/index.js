// F02 — Streaming anomaly detection (AC-F02-1..6)
// No I/O, no network, no process.env, no eval. Only node: built-ins and reference/fleet.js.
import { randomUUID } from 'node:crypto';
import { FAULTS, ASSET_TYPES } from '../../reference/fleet.js';

// ---- helpers -------------------------------------------------------------

// Strict numeric guard — untrusted telemetry must be rejected if not a finite number (AC-F02-6).
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// ISO 10816-3 vibration zone boundaries (AC-F02-2): A ≤2.8 < B ≤4.5 < C ≤7.1 < D.
export function vibrationZone(mmS) {
  if (mmS <= 2.8) return 'A';
  if (mmS <= 4.5) return 'B';
  if (mmS <= 7.1) return 'C';
  return 'D';
}

const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

function zBasedSeverity(absZ, zThreshold) {
  if (absZ < zThreshold) return null;
  if (absZ < zThreshold + 1) return 'low';
  if (absZ < zThreshold + 2) return 'medium';
  if (absZ < zThreshold + 4) return 'high';
  return 'critical';
}

function maxSeverity(a, b) {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

// Known nominal sigma for (assetType, metric) from the reference fleet definitions.
// Used as a floor on the empirical (Welford) stdev so a short warm-up window never
// under-estimates natural spread and triggers spurious anomalies (AC-F02-1, AC-F02-3).
function nominalSigma(assetType, metric) {
  const t = ASSET_TYPES[assetType];
  const nm = t && t.nominal && t.nominal[metric];
  return nm ? nm[1] : null;
}

// Welford online mean/variance, frozen after warm-up (per AC-F02-1 / design risk note).
function updateBaseline(entry, value, warmupTicks, floorSigma) {
  if (entry.frozen) return entry;
  entry.count += 1;
  const delta = value - entry.mean;
  entry.mean += delta / entry.count;
  const delta2 = value - entry.mean;
  entry.m2 += delta * delta2;
  const empirical = entry.count > 1 ? Math.sqrt(entry.m2 / entry.count) : 0;
  entry.stdev = floorSigma != null ? Math.max(empirical, floorSigma) : empirical;
  if (entry.count >= warmupTicks) entry.frozen = true;
  return entry;
}

function zScore(entry, value) {
  const stdev = Math.max(entry.stdev, 1e-6);
  return (value - entry.mean) / stdev;
}

// Static table built from the fleet's own fault effect definitions, so classification
// always matches whatever metrics the simulator actually perturbs per fault.
function buildFailureModeTable() {
  const table = {};
  for (const [fault, def] of Object.entries(FAULTS)) {
    const metrics = new Set([
      ...Object.keys(def.effects || {}),
      ...Object.keys(def.jitter || {}),
    ]);
    if (metrics.size > 0) table[fault] = metrics;
  }
  return table;
}
const FAILURE_MODE_TABLE = buildFailureModeTable();

export function classify(metricNames) {
  const set = new Set(metricNames);
  let best = { failureMode: 'unknown', confidence: 0 };
  let bestScore = -1;
  for (const [fault, metrics] of Object.entries(FAILURE_MODE_TABLE)) {
    const intersection = [...set].filter((m) => metrics.has(m)).length;
    const union = new Set([...set, ...metrics]).size;
    const jaccard = union === 0 ? 0 : intersection / union;
    if (jaccard > bestScore) {
      bestScore = jaccard;
      best = { failureMode: fault, confidence: jaccard };
    }
  }
  // Special-cased default: a lone vibration anomaly with no matching fault signature
  // reads as classic rotating-machinery imbalance (AC-F02-4).
  if (best.failureMode === 'unknown' && set.size === 1 && set.has('vibration')) {
    return { failureMode: 'imbalance', confidence: 1 };
  }
  return best;
}

// ---- detector --------------------------------------------------------------

export function createDetector(opts = {}) {
  const warmupTicks = opts.warmupTicks ?? 30;
  const zThreshold = opts.zThreshold ?? 4.0;

  // Map<assetId, Map<metric, { mean, m2, count, stdev, frozen }>>
  const baselines = new Map();
  const rejected = { count: 0, last: null };

  function freshEntry() {
    return { mean: 0, m2: 0, count: 0, stdev: 0, frozen: false };
  }

  function observe(reading) {
    // Reject malformed / untrusted readings outright (AC-F02-6).
    if (
      !reading ||
      typeof reading !== 'object' ||
      typeof reading.assetId !== 'string' ||
      !reading.metrics ||
      typeof reading.metrics !== 'object'
    ) {
      rejected.count += 1;
      rejected.last = reading ?? null;
      return [];
    }

    const entries = Object.entries(reading.metrics);
    for (const [, value] of entries) {
      if (!isFiniteNumber(value)) {
        // Whole reading is discarded; baseline must never be touched (AC-F02-6).
        rejected.count += 1;
        rejected.last = reading;
        return [];
      }
    }

    let assetBaselines = baselines.get(reading.assetId);
    if (!assetBaselines) {
      assetBaselines = new Map();
      baselines.set(reading.assetId, assetBaselines);
    }

    const anomalousMetrics = [];

    for (const [metric, value] of entries) {
      let entry = assetBaselines.get(metric);
      if (!entry) {
        entry = freshEntry();
        assetBaselines.set(metric, entry);
      }
      const wasFrozen = entry.frozen;
      if (!wasFrozen) {
        updateBaseline(entry, value, warmupTicks, nominalSigma(reading.type, metric));
      }
      if (!entry.frozen) continue; // not enough data yet to score this metric

      const z = zScore(entry, value);
      const absZ = Math.abs(z);

      let severity = null;
      let rule = 'z-score';
      let limit = null;

      if (metric === 'vibration') {
        // ISO 10816 zones describe absolute engineering state. Zone D is an
        // unconditional hard limit (AC-F02-5: zone D must always be critical).
        // Zones B/C only count as anomalous when corroborated by the asset's own
        // statistical baseline, to avoid flagging assets whose normal operating
        // point simply sits closer to a zone boundary than others (AC-F02-3).
        const zone = vibrationZone(value);
        rule = 'iso10816-zone';
        if (zone === 'D') {
          severity = 'critical';
        } else {
          const zSeverity = zBasedSeverity(absZ, zThreshold);
          severity = zSeverity;
        }
      } else {
        severity = zBasedSeverity(absZ, zThreshold);
      }

      if (severity) {
        anomalousMetrics.push({ metric, value, z, severity, rule, limit });
      }
    }

    if (anomalousMetrics.length === 0) return [];

    let overallSeverity = null;
    let primary = anomalousMetrics[0];
    for (const m of anomalousMetrics) {
      overallSeverity = maxSeverity(overallSeverity, m.severity);
      if (SEVERITY_RANK[m.severity] > SEVERITY_RANK[primary.severity]) primary = m;
    }

    const { failureMode, confidence } = classify(anomalousMetrics.map((m) => m.metric));
    const score = Math.max(...anomalousMetrics.map((m) => Math.abs(m.z)));

    const anomaly = {
      id: randomUUID(),
      ts: reading.ts,
      assetId: reading.assetId,
      assetType: reading.type,
      severity: overallSeverity,
      score,
      rule: primary.rule,
      failureMode,
      confidence,
      metrics: anomalousMetrics,
    };

    return [anomaly];
  }

  return { observe, rejected };
}
