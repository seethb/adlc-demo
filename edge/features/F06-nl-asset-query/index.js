// F06 — Natural-language asset queries (NLQ)
// edge/features/F06-nl-asset-query/index.js
//
// Pure, stateless ES module. No I/O, no network, no process.env, no eval.
// Imports only the shared fleet reference data per org standard (ADR-001).
import { FLEET, ASSET_TYPES } from '../../reference/fleet.js';

// ---------------------------------------------------------------------------
// AC-F06-1: ordered intent ladder — first rule that matches wins.
// ---------------------------------------------------------------------------
const INTENT_RULES = [
  { intent: 'inventory', test: (t) => /\b(part|parts|spare|spares|stock|inventory|reorder)\b/.test(t) },
  { intent: 'work_orders', test: (t) => /\bwork\s+orders?\b|\bwos?\b|\bmaintenance backlog\b/.test(t) },
  { intent: 'car', test: (t) => /\bcars?\b|\bcorrective\b|\broot cause\b/.test(t) },
  { intent: 'anomalies', test: (t) => /\banomal\w*|\balarms?\b|\balerts?\b|\bfault\w*|\brisk\b/.test(t) },
  { intent: 'trend', test: (t) => /\btrend\b|\bhistory\b|\blast\s+\d+|\bover time\b/.test(t) },
  { intent: 'ranking', test: (t) => /\bworst\b|\brank\w*|\bmost\b|\bhealthiest\b|\bleast\b/.test(t) },
];

// ---------------------------------------------------------------------------
// AC-F06-2: asset id + asset type resolution.
// ---------------------------------------------------------------------------
const FLEET_ID_SET = new Set(FLEET.map((a) => a.id));
// Matches "MTR-101" and the spaced form "SHF 301"; canonicalized below.
const ASSET_ID_RE = /\b([A-Za-z]{2,6})[\s-]?(\d{2,5})\b/g;

function extractAssetIds(rawText) {
  const out = [];
  const seen = new Set();
  let m;
  ASSET_ID_RE.lastIndex = 0;
  while ((m = ASSET_ID_RE.exec(rawText)) !== null) {
    const candidate = `${m[1].toUpperCase()}-${m[2]}`;
    if (FLEET_ID_SET.has(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      out.push(candidate);
    }
  }
  return out;
}

function extractAssetTypes(t) {
  const types = [];
  const push = (type) => { if (!types.includes(type)) types.push(type); };

  const hasMotor = /\bmotors?\b/.test(t);
  const hasPump = /\bpumps?\b/.test(t);
  const hasCompressor = /\bcompressors?\b/.test(t);
  const hasShaft = /\bshafts?\b/.test(t);
  const hasGearbox = /\bgear\s?box(es)?\b/.test(t);
  const hasBareCentrifugal = /\bcentrifugal\b/.test(t);

  if (hasMotor) push('motor');
  if (hasPump) push('centrifugal_pump');
  if (hasCompressor) push('centrifugal_compressor');
  if (hasShaft) push('shaft');
  if (hasGearbox) push('gearbox');
  // "centrifugal" alone -> centrifugal_pump, unless "compressor" is present
  // (and "pump" isn't already — per spec disambiguation rule).
  if (hasBareCentrifugal && !hasCompressor && !hasPump) push('centrifugal_pump');

  return types;
}

// ---------------------------------------------------------------------------
// AC-F06-3: metrics + time window extraction.
// ---------------------------------------------------------------------------
const METRIC_KEYWORDS = [
  [/\bvibrat\w*|\bshak\w*/, 'vibration'],
  [/\bbearing\w*/, 'bearingTemp'],
  [/\bwinding\w*|\bstator\b/, 'windingTemp'],
  [/\bcurrent\b|\bamps?\b|\bload\b/, 'current'],
  [/\brpm\b|\bspeed\b/, 'rpm'],
  [/\bflow\b/, 'flow'],
  [/\bsuction\b|\bnpsh\b|\bcavitat\w*/, 'suctionPressure'],
  [/\bdischarge pressure\b|\bhead\b/, 'dischargePressure'],
  [/\bmisalign\w*|\balignment\b/, 'misalignment'],
  [/\borbit\b|\brunout\b/, 'shaftOrbit'],
  [/\btorque\b/, 'torque'],
  [/\bsurge\w*/, 'surgeMargin'],
  [/\boil\b/, 'oilTemp'],
  [/\bparticle\w*|\bdebris\b/, 'particleCount'],
];

function extractMetrics(t) {
  const out = [];
  for (const [re, metric] of METRIC_KEYWORDS) {
    if (re.test(t) && !out.includes(metric)) out.push(metric);
  }
  return out;
}

const WINDOW_RE = /last\s+(\d+)\s*(seconds|second|secs|sec|s|minutes|minute|mins|min|m|hours|hour|hrs|hr|h)\b/i;
const UNIT_SECONDS = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
};

function extractWindowSec(t) {
  const m = WINDOW_RE.exec(t);
  if (!m) return 300;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult = UNIT_SECONDS[unit] ?? 60;
  return n * mult;
}

function resolveAssets(assetIds, assetTypes) {
  if (assetIds.length > 0) return assetIds.slice();
  if (assetTypes.length > 0) {
    return FLEET.filter((a) => assetTypes.includes(a.type)).map((a) => a.id);
  }
  return FLEET.map((a) => a.id);
}

/**
 * parseQuery(text) — deterministic NLQ planner.
 * AC-F06-1: intent via ordered ladder.
 * AC-F06-2: asset ids / asset types resolved against the fleet reference.
 * AC-F06-3: metrics and time windows extracted via fixed keyword tables.
 */
export function parseQuery(text) {
  const raw = String(text ?? '');
  const t = raw.toLowerCase();

  let intent = 'condition';
  for (const rule of INTENT_RULES) {
    if (rule.test(t)) { intent = rule.intent; break; }
  }

  const assetIds = extractAssetIds(raw);
  const assetTypes = extractAssetTypes(t);
  const metrics = extractMetrics(t);
  const windowSec = extractWindowSec(t);
  const resolvedAssets = resolveAssets(assetIds, assetTypes);

  return { intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets };
}

/**
 * healthScore(assetType, metrics) — 0..100.
 * AC-F06-4: 100 at nominal, falls below 50 under severe deviation.
 * Uses per-type nominal {mean, sigma} bands from the shared fleet reference;
 * score decays once the worst-offending metric's z-score exceeds 1 sigma.
 */
export function healthScore(assetType, metrics) {
  const spec = ASSET_TYPES[assetType];
  if (!spec || !spec.nominal || !metrics || typeof metrics !== 'object') return 100;

  let maxZ = 0;
  for (const [metric, value] of Object.entries(metrics)) {
    const band = spec.nominal[metric];
    if (!band) continue;
    const [mean, sigma] = band;
    if (!Number.isFinite(value) || !Number.isFinite(sigma) || sigma <= 0) continue;
    const z = Math.abs(value - mean) / sigma;
    if (z > maxZ) maxZ = z;
  }

  let score = 100;
  if (maxZ > 1) score = 100 - (maxZ - 1) * 50;
  return Math.max(0, Math.min(100, Math.round(score)));
}
