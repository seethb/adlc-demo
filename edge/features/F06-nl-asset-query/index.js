// F06 — Natural-language asset queries (NLQ)
// Pure, stateless query planner + health scorer. No I/O, no network, no mutable state.
// Reuses fleet reference data only (per atlas:F06/plan decision — no duplication of
// F02/F03/F05 internal logic). AC ids cited inline below.

import { FLEET, ASSET_TYPES } from '../../reference/fleet.js';

const MAX_LEN = 500; // guard against pathological input before regex matching (ReDoS hygiene)

// ---- AC-F06-1: intent cascade, first match wins, order is normative ----
const INTENT_RULES = [
  { intent: 'inventory', re: /\bparts?\b|\bspares?\b|\bstock\b|\binventory\b|\breorder\b/ },
  { intent: 'work_orders', re: /\bwork\s*orders?\b|\bwos?\b|\bmaintenance\s+backlog\b/ },
  { intent: 'car', re: /\bcars?\b|\bcorrective\b|\broot\s+cause\b/ },
  { intent: 'anomalies', re: /\banomal\w*\b|\balarms?\b|\balerts?\b|\bfault\w*\b|\brisk\b/ },
  { intent: 'trend', re: /\btrend\b|\bhistory\b|\bover\s+time\b|\blast\s+\d+/ },
  { intent: 'ranking', re: /\bworst\b|\brank\w*\b|\bmost\b|\bhealthiest\b|\bleast\b/ },
];

function matchIntent(lower) {
  for (const rule of INTENT_RULES) {
    if (rule.re.test(lower)) return rule.intent;
  }
  return 'condition';
}

// ---- AC-F06-2: asset ids (incl. spaced "SHF 301") ----
const ASSET_ID_RE = /\b([A-Z]{3})[-\s](\d{3})\b/g;

function extractAssetIds(rawText) {
  const ids = new Set();
  let m;
  ASSET_ID_RE.lastIndex = 0;
  while ((m = ASSET_ID_RE.exec(rawText)) !== null) {
    ids.add(`${m[1].toUpperCase()}-${m[2]}`);
  }
  return [...ids];
}

// ---- AC-F06-2: asset types, with compressor-before-bare-centrifugal disambiguation ----
function extractAssetTypes(lower) {
  const types = [];
  const add = (t) => { if (!types.includes(t)) types.push(t); };

  if (/\bmotors?\b/.test(lower)) add('motor');
  if (/\bcompressors?\b/.test(lower)) add('centrifugal_compressor');
  if (/\bpumps?\b/.test(lower) || (/\bcentrifugal\b/.test(lower) && !types.includes('centrifugal_compressor'))) {
    add('centrifugal_pump');
  }
  if (/\bshafts?\b/.test(lower)) add('shaft');
  if (/\bgearbox\b/.test(lower) || /\bgear\s+box\b/.test(lower)) add('gearbox');

  return types;
}

// ---- AC-F06-3: metric keywords ----
const METRIC_KEYWORDS = [
  [/vibrat|shak/, 'vibration'],
  [/bearing/, 'bearingTemp'],
  [/winding|stator/, 'windingTemp'],
  [/\bcurrent\b|\bamps?\b|\bload\b/, 'current'],
  [/\brpm\b|\bspeed\b/, 'rpm'],
  [/\bflow\b/, 'flow'],
  [/suction|npsh|cavitat/, 'suctionPressure'],
  [/discharge\s+pressure|\bhead\b/, 'dischargePressure'],
  [/misalign|alignment/, 'misalignment'],
  [/orbit|runout/, 'shaftOrbit'],
  [/torque/, 'torque'],
  [/surge/, 'surgeMargin'],
  [/\boil\b/, 'oilTemp'],
  [/particle|debris/, 'particleCount'],
];

function extractMetrics(lower) {
  const metrics = [];
  for (const [re, metric] of METRIC_KEYWORDS) {
    if (re.test(lower) && !metrics.includes(metric)) metrics.push(metric);
  }
  return metrics;
}

// ---- AC-F06-3: time windows ----
const WINDOW_RE = /\blast\s+(\d+)\s*(seconds|second|secs|sec|s|minutes|minute|mins|min|m|hours|hour|h)\b/i;
const UNIT_TO_SEC = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hour: 3600, hours: 3600,
};

function extractWindow(lower) {
  const m = WINDOW_RE.exec(lower);
  if (!m) return 300;
  const n = parseInt(m[1], 10);
  const unit = UNIT_TO_SEC[m[2].toLowerCase()];
  if (!Number.isFinite(n) || !unit) return 300;
  return n * unit;
}

// ---- resolution of the slice of fleet to answer from ----
function resolveAssets(assetIds, assetTypes) {
  if (assetIds.length) return assetIds;
  if (assetTypes.length) {
    const ids = FLEET.filter((a) => assetTypes.includes(a.type)).map((a) => a.id);
    if (ids.length) return ids;
  }
  return FLEET.map((a) => a.id);
}

/**
 * parseQuery — deterministic NL query planner.
 * AC-F06-1: intent cascade. AC-F06-2: asset ids/types. AC-F06-3: metrics/window.
 */
export function parseQuery(text) {
  const raw = typeof text === 'string' ? text : String(text ?? '');
  const bounded = raw.slice(0, MAX_LEN);
  const lower = bounded.toLowerCase();

  const intent = matchIntent(lower);
  const assetIds = extractAssetIds(bounded);
  const assetTypes = extractAssetTypes(lower);
  const metrics = extractMetrics(lower);
  const windowSec = extractWindow(lower);
  const resolvedAssets = resolveAssets(assetIds, assetTypes);

  return { intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets };
}

/**
 * healthScore — AC-F06-4: 100 at nominal, falls below 50 with severe deviation.
 * Uses ASSET_TYPES[type].nominal[metric] = [mean, sigma] from the shared fleet
 * reference data (no re-derivation of F02's internal detection logic).
 */
export function healthScore(assetType, metrics) {
  const spec = ASSET_TYPES[assetType];
  if (!spec || !spec.nominal || !metrics || typeof metrics !== 'object') return 100;

  let maxZ = 0;
  let sumSq = 0;
  let n = 0;

  for (const [metric, value] of Object.entries(metrics)) {
    if (!Number.isFinite(value)) continue; // untrusted input: reject non-finite values
    const nom = spec.nominal[metric];
    if (!nom) continue;
    const [mean, sigma] = nom;
    if (!(sigma > 0)) continue;
    const z = Math.abs(value - mean) / sigma;
    maxZ = Math.max(maxZ, z);
    sumSq += z * z;
    n += 1;
  }

  if (n === 0) return 100;

  const rms = Math.sqrt(sumSq / n);
  const combined = maxZ * 0.6 + rms * 0.4;
  const score = 100 - 14 * Math.pow(combined, 1.4);

  return Math.round(Math.max(0, Math.min(100, score)));
}
