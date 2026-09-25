// F02 · Streaming anomaly detection
// Pure ES module, no I/O, no network, no process.env, no eval.
// Only imports node: built-ins and the shared fleet reference (org standard ADR-001).
import { randomUUID } from 'node:crypto';
import { FAULTS } from '../../reference/fleet.js';

// ---- ISO 10816-3 vibration zones -----------------------------------------
// AC-F02-2: A <= 2.8 < B <= 4.5 < C <= 7.1 < D (mm/s RMS)
export function vibrationZone(mmS) {
  if (mmS <= 2.8) return 'A';
  if (mmS <= 4.5) return 'B';
  if (mmS <= 7.1) return 'C';
  return 'D';
}

// ---- Failure-mode classification ------------------------------------------
// AC-F02-4: classify an anomalous-metric-name set into the failure mode whose
// declared effects best match, using the shared fleet fault table (data
// driven, no hard-coded per-fault metric lists so it stays in sync with the
// fleet reference).
export function classify(metricNames) {
  const set = new Set(metricNames || []);
  let best = null;
  let bestScore = -1;
  for (const [fault, def] of Object.entries(FAULTS || {})) {
    const effectMetrics = Object.keys(def.effects || {});
    if (effectMetrics.length === 0) continue;
    const overlap = effectMetrics.filter((m) => set.has(m)).length;
    if (overlap === 0) continue;
    const denom = Math.max(effectMetrics.length, set.size, 1);
    const score = overlap / denom;
    if (score > bestScore) {
      bestScore = score;
      best = fault;
    }
  }
  if (!best) return { failureMode: 'unknown', confidence: 0 };
  return { failureMode: best, confidence: Math.min(1, bestScore) };
}

// ---- Internal helpers -------------------------------------------------------

// AC-F02-6: telemetry is untrusted input (IoT security standard) — reject any
// reading whose metrics are not all finite numbers, before it can touch a
// baseline or be scored.
function isFiniteReading(reading) {
  if (!reading || typeof reading !== 'object') return false;
  if (typeof reading.assetId !== 'string' || reading.assetId.length === 0) return false;
  const metrics = reading.metrics;
  if (!metrics || typeof metrics !== 'object') return false;
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

function severityFor(metric, value, z) {
  if (metric === 'vibration') {
    const zone = vibrationZone(value);
    if (zone === 'D') return 'critical';
    if (zone === 'C') return 'high';
    if (zone === 'B') return 'medium';
    return 'low';
  }
  const az = Math.abs(z);
  if (az >= 8) return 'critical';
  if (az >= 6) return 'high';
  if (az >= 4) return 'medium';
  return 'low';
}

const SEVERITY_RANK = { low: 0, medium: 1, high: 2, critical: 3 };

function makeAnomalyId() {
  return `anm_${randomUUID()}`;
}

// ---- Detector ----------------------------------------------------------------
// AC-F02-1/3/4/5/6: per-asset, per-metric frozen baseline (Welford stats),
// combined with two complementary detectors so both sudden and slow-drift
// faults are caught within the required window while healthy fleets stay
// under the false-positive budget:
//  - z-score vs a frozen baseline (sudden/step faults)
//  - CUSUM on the z-score (slow, sustained drift such as bearing_wear)
//  - ISO 10816 zone-D vibration is always flagged (hard safety limit),
//    independent of baseline freeze state, since it is an absolute limit.
//
// Fix (AC-F02-1 / AC-F02-3 regression): a near-constant metric can freeze
// with an almost-zero spread; any subsequent natural jitter would then blow
// up the z-score and fire on every reading of every asset. The spread floor
// is therefore relative to the metric's own magnitude at freeze time, not a
// bare epsilon, and CUSUM/jitter thresholds are set with enough average
// run-length to keep the healthy-fleet false-positive budget comfortably
// under 1% over the AC-F02-1 window (300 ticks x 8 assets x several metrics).
export function createDetector(opts = {}) {
  const warmupTicks = opts.warmupTicks ?? 30;
  const zThreshold = opts.zThreshold ?? 4.5;
  const cusumK = opts.cusumK ?? 0.6;
  const cusumH = opts.cusumH ?? 10;

  // baselines: Map<assetId, Map<metric, stats>>
  const baselines = new Map();
  // tickCounts: Map<assetId, number> — used to gate baseline freezing.
  const tickCounts = new Map();

  const rejected = { count: 0, last: null };

  function observe(reading) {
    // AC-F02-6: reject non-finite/untrusted telemetry before any scoring or
    // baseline mutation; never let it corrupt state.
    if (!isFiniteReading(reading)) {
      rejected.count += 1;
      rejected.last = reading;
      return [];
    }

    const { assetId, assetType, ts, metrics } = reading;

    let assetBaselines = baselines.get(assetId);
    if (!assetBaselines) {
      assetBaselines = new Map();
      baselines.set(assetId, assetBaselines);
    }

    const prevCount = tickCounts.get(assetId) || 0;
    const newCount = prevCount + 1;
    tickCounts.set(assetId, newCount);

    const flagged = [];

    for (const [metric, rawValue] of Object.entries(metrics)) {
      let stats = assetBaselines.get(metric);
      if (!stats) {
        stats = {
          n: 0, mean: 0, m2: 0, frozen: false, spread: 0,
          cusumPos: 0, cusumNeg: 0,
        };
        assetBaselines.set(metric, stats);
      }

      const meanBefore = stats.mean;
      const spreadBefore = stats.frozen
        ? stats.spread
        : (stats.n > 1 ? Math.sqrt(stats.m2 / (stats.n - 1)) : 0);
      const z = spreadBefore > 1e-9 ? (rawValue - meanBefore) / spreadBefore : 0;

      if (!stats.frozen) {
        updateBaseline(stats, rawValue);
        // AC-F02-1: freeze the spread after warm-up so slow drift does not
        // get silently absorbed into the baseline (Meko architecture note).
        if (newCount >= warmupTicks) {
          stats.frozen = true;
          const rawSpread = stats.n > 1 ? Math.sqrt(stats.m2 / (stats.n - 1)) : 0;
          // Relative floor prevents a near-constant metric from producing a
          // hair-trigger spread that turns tiny natural jitter into a huge
          // z-score for every future reading (root cause of the FP leak).
          const relFloor = Math.abs(stats.mean) * 1e-3;
          stats.spread = Math.max(rawSpread, relFloor, 1e-6);
        }
      }

      // CUSUM on the signed z-score — catches slow sustained drift.
      stats.cusumPos = Math.max(0, stats.cusumPos + z - cusumK);
      stats.cusumNeg = Math.max(0, stats.cusumNeg - z - cusumK);
      const cusum = Math.max(stats.cusumPos, stats.cusumNeg);

      const zone = metric === 'vibration' ? vibrationZone(rawValue) : null;
      const forcedZoneD = zone === 'D'; // absolute safety limit, always active
      const zAnom = stats.frozen && Math.abs(z) >= zThreshold;
      const cusumAnom = stats.frozen && cusum >= cusumH;

      if (zAnom || cusumAnom || forcedZoneD) {
        const rule = forcedZoneD ? 'iso-zone-d' : zAnom ? 'z-score' : 'cusum';
        const limit = meanBefore + Math.sign(z || 1) * zThreshold * spreadBefore;
        flagged.push({
          metric,
          value: rawValue,
          z,
          severity: severityFor(metric, rawValue, z),
          rule,
          limit,
        });
        // Reset accumulators after a flag so a single sustained excursion
        // does not produce an unbounded run of anomalies from stale state.
        stats.cusumPos = 0;
        stats.cusumNeg = 0;
      }
    }

    if (flagged.length === 0) return [];

    const metricNames = flagged.map((f) => f.metric);
    const { failureMode, confidence } = classify(metricNames);
    const severity = flagged.reduce(
      (acc, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[acc] ? f.severity : acc),
      'low',
    );
    const score = Math.max(...flagged.map((f) => Math.abs(f.z)), 0);

    // AC-F02-5: full contract shape on every anomaly.
    const anomaly = {
      id: makeAnomalyId(),
      ts,
      assetId,
      assetType,
      severity,
      score,
      rule: flagged[0].rule,
      failureMode,
      confidence,
      metrics: flagged,
    };

    return [anomaly];
  }

  return { observe, rejected };
}
