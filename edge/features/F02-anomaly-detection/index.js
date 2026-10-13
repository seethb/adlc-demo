// F02 — Streaming anomaly detection (edge/features/F02-anomaly-detection/index.js)
//
// Pure ES module, no I/O, no network, no env, no eval. Only node: built-ins and
// '../../reference/fleet.js' are imported (org standard ADR-001).
//
// Security note (OWASP IoT I5 / org IoT security standard): telemetry is
// untrusted input. Every reading is validated before it ever touches a
// baseline; non-finite values, unknown asset types and out-of-order/replayed
// timestamps are rejected and counted, never scored (AC-F02-6).

import { ASSET_TYPES, FAULTS } from '../../reference/fleet.js';

// ---- AC-F02-2: ISO 10816 vibration zones -----------------------------------
// A <= 2.8 < B <= 4.5 < C <= 7.1 < D (mm/s RMS)
export function vibrationZone(mmS) {
  if (mmS <= 2.8) return 'A';
  if (mmS <= 4.5) return 'B';
  if (mmS <= 7.1) return 'C';
  return 'D';
}

// ISO 10816 interpretation: zones A/B are the acceptable operating envelope
// for healthy machinery; only C (unsatisfactory) and D (unacceptable/damage)
// are treated as engineering-limit anomalies. Treating zone B as anomalous
// was the root cause of cross-asset false positives (AC-F02-3 regression):
// a healthy asset naturally sitting in zone B must never fire.
const ZONE_LIMIT_SEVERITY = { A: null, B: null, C: 'medium', D: 'critical' };

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// AC-F02-6: validate untrusted telemetry before any baseline interaction.
function validateReading(reading) {
  if (!reading || typeof reading !== 'object') return { ok: false, reason: 'malformed' };
  const { assetId, type, metrics, ts } = reading;
  if (typeof assetId !== 'string' || assetId.length === 0) return { ok: false, reason: 'bad-asset-id' };
  if (typeof ts !== 'string' || ts.length === 0) return { ok: false, reason: 'bad-ts' };
  if (!metrics || typeof metrics !== 'object') return { ok: false, reason: 'bad-metrics' };
  for (const v of Object.values(metrics)) {
    if (!isFiniteNumber(v)) return { ok: false, reason: 'non-finite-metric' };
  }
  if (type !== undefined && type !== null && !ASSET_TYPES[type]) return { ok: false, reason: 'unknown-type' };
  return { ok: true };
}

const SEV_RANK = { low: 1, medium: 2, high: 3, critical: 4 };
function sevRank(s) { return SEV_RANK[s] || 0; }
function worseSeverity(a, b) { return sevRank(a) >= sevRank(b) ? (a || b) : b; }

// Statistical severity from a z-score. Thresholds are tuned conservatively
// (above the natural noise band observed on a healthy fleet, see
// AC-F02-1/AC-F02-3 regression fix below) so that healthy telemetry — even
// on assets *other* than the one under fault injection — never crosses the
// anomaly bar, while injected faults (which drive sustained, large drift)
// are still caught well within the 30-tick detection window.
function zSeverity(z) {
  const az = Math.abs(z);
  if (az >= 9) return 'critical';
  if (az >= 7) return 'high';
  if (az >= 5.5) return 'medium';
  if (az >= 4.5) return 'low';
  return null;
}

// ---- AC-F02-4: failure-mode classification ---------------------------------
// Generic, fleet-data-driven classifier: match the set of anomalous metric
// names against each known fault's effect-metric set (from reference/fleet.js)
// using a Jaccard similarity, so it needs no hardcoded metric-name tables.
export function classify(metricNames) {
  const input = new Set((metricNames || []).filter(Boolean));
  let best = null;
  for (const [mode, def] of Object.entries(FAULTS || {})) {
    const effectKeys = Object.keys((def && def.effects) || {});
    const keySet = new Set(effectKeys);
    let inter = 0;
    for (const m of input) if (keySet.has(m)) inter += 1;
    const union = new Set([...input, ...keySet]).size;
    const score = union === 0 ? 0 : inter / union;
    if (!best || score > best.score) best = { failureMode: mode, score };
  }
  if (!best || best.score === 0) return { failureMode: 'unknown', confidence: 0 };
  return { failureMode: best.failureMode, confidence: Math.min(1, best.score) };
}

// ---- Detector ----------------------------------------------------------------
export function createDetector(opts = {}) {
  const warmupTicks = opts.warmupTicks ?? 35;
  const zThresholdFloor = opts.zThreshold ?? 4.5; // matches zSeverity low cutoff

  // Baseline: per-asset, per-metric Welford online mean/variance. Frozen once
  // warmupTicks samples are seen so slow drift cannot be absorbed into the
  // baseline (architecture decision recorded in Meko, risk mitigation for AC-F02-1).
  const baselines = new Map(); // assetId -> Map(metric -> state)
  const lastTs = new Map(); // assetId -> last accepted ts (monotonic/replay guard)
  const rejected = { count: 0, last: null };
  let seq = 0;

  function getMetricState(assetId, metric) {
    let perAsset = baselines.get(assetId);
    if (!perAsset) { perAsset = new Map(); baselines.set(assetId, perAsset); }
    let state = perAsset.get(metric);
    if (!state) {
      state = { n: 0, mean: 0, m2: 0, frozen: false, frozenMean: 0, frozenStd: 0 };
      perAsset.set(metric, state);
    }
    return state;
  }

  function updateBaseline(state, value) {
    if (state.frozen) return;
    state.n += 1;
    const delta = value - state.mean;
    state.mean += delta / state.n;
    const delta2 = value - state.mean;
    state.m2 += delta * delta2;
    if (state.n >= warmupTicks) {
      state.frozen = true;
      state.frozenMean = state.mean;
      state.frozenStd = state.n > 1 ? Math.sqrt(state.m2 / (state.n - 1)) : 0;
    }
  }

  // Sigma floor: a small relative floor (2% of |mean|) plus an absolute
  // epsilon prevents metrics whose natural variance happens to be tiny
  // during warm-up from producing artificially huge z-scores for ordinary
  // noise — the root cause of false positives both fleet-wide (AC-F02-1)
  // and on assets unrelated to an injected fault (AC-F02-3).
  function effectiveSigma(mean, sd) {
    return Math.max(sd, Math.abs(mean) * 0.02, 1e-6);
  }

  function zScore(state, value) {
    const mean = state.frozen ? state.frozenMean : state.mean;
    const sd = state.frozen ? state.frozenStd : (state.n > 1 ? Math.sqrt(state.m2 / (state.n - 1)) : 0);
    const sigma = effectiveSigma(mean, sd);
    return (value - mean) / sigma;
  }

  function observe(reading) {
    const v = validateReading(reading);
    if (!v.ok) {
      // AC-F02-6: untrusted/malformed telemetry is rejected, counted, and
      // never reaches the baseline or the scoring path.
      rejected.count += 1;
      rejected.last = reading;
      return [];
    }

    // Reject out-of-order/replayed readings (OWASP IoT I5 / org security standard).
    const prevTs = lastTs.get(reading.assetId);
    if (prevTs && reading.ts <= prevTs) {
      rejected.count += 1;
      rejected.last = reading;
      return [];
    }
    lastTs.set(reading.assetId, reading.ts);

    const hits = [];
    for (const [metric, value] of Object.entries(reading.metrics)) {
      const state = getMetricState(reading.assetId, metric);
      updateBaseline(state, value); // no-op once frozen; per-asset isolation keeps faults from leaking across assets (AC-F02-3)
      const z = zScore(state, value);

      let severity = Math.abs(z) >= zThresholdFloor ? zSeverity(z) : null;
      let rule = severity ? 'zscore' : null;
      let limit = null;

      if (metric === 'vibration') {
        // AC-F02-2 / AC-F02-5: ISO 10816 zone governs vibration severity;
        // zone D is always critical regardless of the statistical z-score.
        const zone = vibrationZone(value);
        const limitSev = ZONE_LIMIT_SEVERITY[zone];
        if (limitSev) {
          severity = worseSeverity(severity, limitSev);
          rule = 'iso10816';
          limit = zone;
        }
      }

      if (severity) {
        hits.push({ metric, value, z: Number(z.toFixed(3)), severity, rule, limit });
      }
    }

    if (hits.length === 0) return [];

    let overall = null;
    let score = 0;
    for (const h of hits) {
      overall = worseSeverity(overall, h.severity);
      score = Math.max(score, Math.abs(h.z));
    }

    const { failureMode, confidence } = classify(hits.map(h => h.metric));
    seq += 1;

    const anomaly = {
      id: `${reading.assetId}-${reading.ts}-${seq}`,
      ts: reading.ts,
      assetId: reading.assetId,
      assetType: reading.type,
      severity: overall,
      score: Number(score.toFixed(3)),
      rule: hits[0].rule,
      failureMode,
      confidence,
      metrics: hits,
    };

    return [anomaly];
  }

  return { observe, rejected };
}
