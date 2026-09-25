// F02 · Streaming anomaly detection
// AC-F02-1..AC-F02-6 — see specs/features/F02-anomaly-detection.md.
// Pure ES module: no I/O, no network, no eval. Only node: built-ins and the
// shared fleet reference are imported (ADR-002). Edge analytics is read-only
// towards OT (IEC 62443) — this module only consumes Readings, never writes.
import crypto from 'node:crypto';
import { FLEET, FAULTS } from '../../reference/fleet.js';

const FLEET_BY_ID = new Map(FLEET.map((a) => [a.id, a]));

const WARMUP_DEFAULT = 30;
const Z_THRESHOLD_DEFAULT = 4;

const SEV_ORDER = ['low', 'medium', 'high', 'critical'];
function maxSeverity(a, b) {
  if (!a) return b;
  if (!b) return a;
  return SEV_ORDER.indexOf(a) >= SEV_ORDER.indexOf(b) ? a : b;
}

// AC-F02-2: ISO 10816-3 vibration zones (mm/s RMS): A ≤ 2.8 < B ≤ 4.5 < C ≤ 7.1 < D.
export function vibrationZone(mmS) {
  if (mmS <= 2.8) return 'A';
  if (mmS <= 4.5) return 'B';
  if (mmS <= 7.1) return 'C';
  return 'D';
}

function vibSeverity(zone) {
  if (zone === 'D') return 'critical'; // AC-F02-5: zone-D vibration is always critical.
  if (zone === 'C') return 'high';
  if (zone === 'B') return 'medium';
  return 'low';
}

function zSeverity(z) {
  const az = Math.abs(z);
  if (az >= 8) return 'critical';
  if (az >= 6) return 'high';
  if (az >= 4) return 'medium';
  return 'low';
}

// Fault signatures are derived from the shared fleet reference itself (ground
// truth): each fault's effect-metric set is its "signature". This keeps
// classification in sync with whatever FAULTS actually perturbs, instead of a
// hand-maintained table that could drift (AC-F02-4).
const FAULT_SIGNATURES = Object.entries(FAULTS)
  .map(([name, def]) => ({ name, metrics: new Set(Object.keys(def.effects || {})) }))
  .filter((sig) => sig.metrics.size > 0);

// classify(metricNames) -> { failureMode, confidence }
// A fault is proposed only when a strict majority (>50%) of the metrics that
// define its signature are present among the observed anomalous metrics;
// ties favour the larger (more specific) signature. Otherwise we fall back to
// the generic mechanical label 'imbalance' (AC-F02-4).
export function classify(metricNames) {
  const input = new Set(metricNames);
  let best = null;
  for (const sig of FAULT_SIGNATURES) {
    let overlap = 0;
    for (const m of sig.metrics) if (input.has(m)) overlap += 1;
    const ratio = overlap / sig.metrics.size;
    if (
      ratio > 0.5 &&
      (!best || ratio > best.ratio || (ratio === best.ratio && sig.metrics.size > best.size))
    ) {
      best = { name: sig.name, ratio, size: sig.metrics.size };
    }
  }
  if (best) {
    const confidence = Math.min(0.95, 0.5 + 0.4 * best.ratio);
    return { failureMode: best.name, confidence };
  }
  return { failureMode: 'imbalance', confidence: 0.5 };
}

// AC-F02-6 / IoT security standard: telemetry is untrusted input. Reject any
// reading that is not a well-formed object with a known assetId, a finite
// numeric timestamp, and metrics that are all finite numbers (rejects NaN,
// Infinity, -Infinity and non-numeric types such as strings).
function isFiniteReading(reading) {
  if (!reading || typeof reading !== 'object') return false;
  if (typeof reading.assetId !== 'string' || !FLEET_BY_ID.has(reading.assetId)) return false;
  if (typeof reading.ts !== 'number' || !Number.isFinite(reading.ts)) return false;
  const metrics = reading.metrics;
  if (!metrics || typeof metrics !== 'object') return false;
  const keys = Object.keys(metrics);
  if (keys.length === 0) return false;
  for (const v of Object.values(metrics)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  }
  return true;
}

function updateBaseline(stats, value) {
  stats.n += 1;
  const delta = value - stats.mean;
  stats.mean += delta / stats.n;
  const delta2 = value - stats.mean;
  stats.m2 += delta * delta2;
}

function makeAnomalyId() {
  return crypto.randomUUID();
}

// createDetector(opts?) -> { observe(reading): Anomaly[], rejected: { count, last } }
export function createDetector(opts = {}) {
  const warmupTicks = opts.warmupTicks ?? WARMUP_DEFAULT;
  const zThreshold = opts.zThreshold ?? Z_THRESHOLD_DEFAULT;

  // Per-asset, per-metric Welford baselines. The spread FREEZES once warm-up
  // completes so slow drift is never absorbed into "normal" (see spec risks).
  const baselines = new Map(); // assetId -> Map<metric, stats>

  const rejected = { count: 0, last: null };

  function getStats(assetBaselines, metric) {
    let s = assetBaselines.get(metric);
    if (!s) {
      s = { n: 0, mean: 0, m2: 0, frozen: false, frozenMean: 0, frozenSpread: 0 };
      assetBaselines.set(metric, s);
    }
    return s;
  }

  function observe(reading) {
    // AC-F02-6: untrusted telemetry — reject before it can touch any baseline.
    if (!isFiniteReading(reading)) {
      rejected.count += 1;
      rejected.last = reading;
      return [];
    }

    const assetId = reading.assetId;
    const assetType = reading.assetType || FLEET_BY_ID.get(assetId)?.type || 'unknown';

    let assetBaselines = baselines.get(assetId);
    if (!assetBaselines) {
      assetBaselines = new Map();
      baselines.set(assetId, assetBaselines);
    }

    const triggered = [];

    for (const [metric, value] of Object.entries(reading.metrics)) {
      const stats = getStats(assetBaselines, metric);

      if (!stats.frozen) {
        // AC-F02-1: still learning — never score during warm-up.
        updateBaseline(stats, value);
        if (stats.n >= warmupTicks) {
          stats.frozen = true;
          stats.frozenMean = stats.mean;
          stats.frozenSpread = Math.max(Math.sqrt(stats.m2 / Math.max(stats.n - 1, 1)), 1e-6);
        }
        continue;
      }

      const mean = stats.frozenMean;
      const spread = stats.frozenSpread;
      const z = (value - mean) / spread;

      let isAnomalous = false;
      let severity = null;
      let rule = null;
      let limit = null;

      if (Math.abs(z) >= zThreshold) {
        isAnomalous = true;
        severity = zSeverity(z);
        rule = 'z-score';
        limit = mean + Math.sign(z) * zThreshold * spread;
      }

      // AC-F02-2/AC-F02-5: ISO 10816 engineering limit, independent of the
      // statistical baseline — a zone-D reading is always a real anomaly and
      // always escalates to 'critical' severity.
      if (metric === 'vibration') {
        const zone = vibrationZone(value);
        const zoneSeverity = vibSeverity(zone);
        if (zone === 'D') {
          isAnomalous = true;
          severity = maxSeverity(severity, zoneSeverity);
          rule = rule ? `${rule}+iso10816` : 'iso10816';
          limit = 7.1;
        } else if (isAnomalous) {
          severity = maxSeverity(severity, zoneSeverity);
        }
      }

      if (isAnomalous) {
        triggered.push({ metric, value, z, severity, rule, limit });
      }
    }

    if (triggered.length === 0) return [];

    const overallSeverity = triggered.reduce((acc, m) => maxSeverity(acc, m.severity), null);
    const { failureMode, confidence } = classify(triggered.map((m) => m.metric));
    const score = Math.max(...triggered.map((m) => Math.abs(m.z)));
    const primary = triggered.reduce(
      (best, m) => (SEV_ORDER.indexOf(m.severity) > SEV_ORDER.indexOf(best.severity) ? m : best),
      triggered[0],
    );

    const anomaly = {
      id: makeAnomalyId(),
      ts: reading.ts,
      assetId,
      assetType,
      severity: overallSeverity,
      score,
      rule: primary.rule,
      failureMode,
      confidence,
      metrics: triggered,
    };

    return [anomaly];
  }

  return { observe, rejected };
}
