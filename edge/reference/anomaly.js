// F02 — Streaming anomaly detection (reference implementation).
// Spec: specs/features/F02-anomaly-detection.spec.md
// Two detectors vote per reading: a baseline z-score on every metric (AC-F02-1)
// and engineering limits — ISO 10816 vibration zones plus OEM limits (AC-F02-2).
// The anomalous metric set is then matched to a failure-mode signature (AC-F02-4).

export const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const rank = s => SEVERITIES.indexOf(s);
const maxSev = (a, b) => (rank(a) >= rank(b) ? a : b);

// ISO 10816-3 (group 2 machines, rigid foundation), velocity RMS in mm/s.
export function vibrationZone(mmS) {
  if (mmS <= 2.8) return 'A';
  if (mmS <= 4.5) return 'B';
  if (mmS <= 7.1) return 'C';
  return 'D';
}

// [metric, comparator, high limit, critical limit]
export const LIMITS = [
  ['bearingTemp', '>', 85, 95],
  ['windingTemp', '>', 110, 130],
  ['surgeMargin', '<', 10, 5],
  ['suctionPressure', '<', 0.9, 0.6],
  ['misalignment', '>', 0.1, 0.2],
  ['shaftOrbit', '>', 60, 80],
  ['particleCount', '>', 30, 45],
  ['oilTemp', '>', 80, 90],
  ['dischargeTemp', '>', 150, 165],
];

// Ordered most-specific first; the first signature whose `any` metrics are
// anomalous wins. `support` metrics raise confidence.
export const SIGNATURES = [
  { mode: 'surge',            any: ['surgeMargin'],                    support: ['dischargeTemp', 'vibration'] },
  { mode: 'cavitation',       any: ['suctionPressure', 'flow'],        support: ['vibration', 'dischargePressure'] },
  { mode: 'misalignment',     any: ['misalignment', 'shaftOrbit'],     support: ['vibration'] },
  { mode: 'winding_overheat', any: ['windingTemp', 'current', 'powerFactor'], support: [] },
  { mode: 'lubrication',      any: ['particleCount', 'oilTemp'],       support: ['vibration'] },
  { mode: 'bearing_wear',     any: ['bearingTemp'],                    support: ['vibration'] },
  { mode: 'imbalance',        any: ['vibration'],                      support: [] },
];

export function classify(metricNames) {
  const set = new Set(metricNames);
  for (const sig of SIGNATURES) {
    const hits = sig.any.filter(m => set.has(m));
    if (hits.length) {
      const sup = sig.support.filter(m => set.has(m)).length;
      const confidence = Math.min(0.99, 0.55 + 0.15 * hits.length + (sig.support.length ? 0.25 * (sup / sig.support.length) : 0.1));
      return { failureMode: sig.mode, confidence: Math.round(confidence * 100) / 100 };
    }
  }
  return { failureMode: 'unknown', confidence: 0.3 };
}

// The baseline learns fast during warm-up, then slowly, so gradual degradation
// (bearing wear, fouling) is not absorbed into "normal".
export function createDetector({ alphaSlow = 0.005, zThreshold = 6, warmup = 30, sigmaFloor = 0.01 } = {}) {
  const baselines = new Map(); // `${asset}:${metric}` -> { n, mean, varc }
  let seq = 0;

  function score(key, x) {
    let b = baselines.get(key);
    if (!b) { b = { n: 0, mean: 0, varc: 0 }; baselines.set(key, b); }
    const sd = Math.max(Math.sqrt(b.varc), Math.abs(b.mean) * sigmaFloor, 1e-6);
    const z = b.n >= warmup ? Math.abs(x - b.mean) / sd : 0;
    // Only clearly-normal points (z < 2) nudge the baseline after warm-up, and
    // the spread is frozen then, so slow drifts keep scoring instead of being learnt.
    if (b.n < warmup || z < 2) {
      b.n += 1;
      const d = x - b.mean;
      if (b.n <= warmup) {
        // Welford: exact mean/variance over the warm-up window.
        b.mean += d / b.n;
        b.m2 = (b.m2 ?? 0) + d * (x - b.mean);
        b.varc = b.n > 1 ? b.m2 / (b.n - 1) : 0;
      } else {
        b.mean += alphaSlow * d;
      }
    }
    return z;
  }

  const rejected = { count: 0, last: null };

  function observe(reading) {
    // Telemetry is untrusted input (IoT security standard, AC-F02-6): a reading
    // with any non-finite value is rejected whole and never touches a baseline.
    const values = Object.values(reading?.metrics ?? {});
    if (!reading?.assetId || !values.length || values.some(v => typeof v !== 'number' || !Number.isFinite(v))) {
      rejected.count += 1;
      rejected.last = { assetId: reading?.assetId ?? null, ts: reading?.ts ?? null };
      return [];
    }
    const findings = [];
    let severity = null;
    for (const [metric, value] of Object.entries(reading.metrics)) {
      const z = score(`${reading.assetId}:${metric}`, value);
      let sev = null, rule = null, limit = null;
      if (z >= zThreshold) { sev = z >= zThreshold * 2 ? 'high' : 'medium'; rule = 'baseline-z'; }
      if (metric === 'vibration') {
        const zone = vibrationZone(value);
        if (zone === 'C') { sev = maxSev(sev ?? 'low', 'high'); rule = 'iso10816-zone-C'; limit = 4.5; }
        if (zone === 'D') { sev = 'critical'; rule = 'iso10816-zone-D'; limit = 7.1; }
      }
      const lim = LIMITS.find(l => l[0] === metric);
      if (lim) {
        const [, cmp, hi, crit] = lim;
        const beyond = t => (cmp === '>' ? value > t : value < t);
        if (beyond(crit)) { sev = 'critical'; rule = 'limit-critical'; limit = crit; }
        else if (beyond(hi)) { sev = maxSev(sev ?? 'low', 'high'); rule = rule ?? 'limit-high'; limit = hi; }
      }
      if (sev) {
        findings.push({ metric, value, z: Math.round(z * 10) / 10, severity: sev, rule, limit });
        severity = severity ? maxSev(severity, sev) : sev;
      }
    }
    if (!findings.length) return [];
    const { failureMode, confidence } = classify(findings.map(f => f.metric));
    const top = findings.reduce((a, b) => (rank(b.severity) > rank(a.severity) || (b.severity === a.severity && b.z > a.z) ? b : a));
    return [{
      id: `AN-${++seq}`,
      ts: reading.ts,
      assetId: reading.assetId,
      assetType: reading.type,
      severity,
      score: top.z,
      rule: top.rule,
      failureMode,
      confidence,
      metrics: findings,
    }];
  }

  return { observe, baselines, rejected };
}
