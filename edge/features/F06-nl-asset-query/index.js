// F06 · Natural-language asset queries (NLQ)
// Pure, read-only, deterministic query planner over in-memory fleet state.
// Per org security standard, telemetry/metric inputs are treated as untrusted:
// non-finite values are ignored (never scored, never crash `healthScore`),
// and only known asset ids / asset types / metrics (from the fleet reference)
// are ever resolved — unknown tokens are silently dropped rather than guessed.
// No I/O, no network, no OT writes (edge analytics is read-only towards OT).

import { FLEET, ASSET_TYPES } from '../../reference/fleet.js';

// ---------------------------------------------------------------------------
// Lexicons (AC-F06-2, AC-F06-3)
// ---------------------------------------------------------------------------

// Known asset types come straight from the fleet reference so the lexicon
// never drifts from what `resolveAssets` can actually resolve.
const ASSET_TYPE_LEXICON = Object.keys(ASSET_TYPES).map((type) => ({
  type,
  // e.g. "centrifugal pump" -> /centrifugal\s+pumps?\b/i
  // "centrifugal" alone never matches — the full phrase (incl. "pump"/
  // "compressor") is required, resolving the pump/compressor ambiguity.
  re: new RegExp(`\\b${type.replace(/\s+/g, '\\s+')}s?\\b`, 'i'),
}));

// metric name -> matcher, ordered from most specific to most generic so that
// e.g. "bearing temp" is captured before the generic "temperature" catch-all.
// "cavitation risk" maps to the underlying suctionPressure metric that
// actually drives cavitation detection on centrifugal pumps (AC-F06-3).
const METRIC_LEXICON = [
  ['bearingTemp', /\bbearing\s*temp(erature)?\b/i],
  ['windingTemp', /\bwinding\s*temp(erature)?\b/i],
  ['dischargeTemp', /\bdischarge\s*temp(erature)?\b/i],
  ['surgeMargin', /\bsurge\b/i],
  ['suctionPressure', /\bcavitation\b|\bsuction\s*pressure\b/i],
  ['vibration', /\bvibration\b/i],
  ['pressure', /\bpressure\b/i],
  ['flow', /\bflow\b/i],
  ['current', /\bcurrent\b/i],
  ['rpm', /\brpm\b/i],
  ['powerFactor', /\bpower\s*factor\b/i],
  ['temperature', /\btemp(erature)?\b/i],
];

// Intent patterns, checked in order — first match wins (AC-F06-1).
const INTENT_PATTERNS = [
  ['work_orders', /\bwork\s*orders?\b/i],
  ['car', /\bcorrective\s+action\b|\bcars?\b/i],
  ['inventory', /\b(spare\s*parts?|inventory|stock(?:ed)?|on\s+hand)\b/i],
  ['anomalies', /\b(anomal(y|ies)|unusual|abnormal|deviat\w*)\b/i],
  ['ranking', /\b(which|top|worst|rank\w*|best|highest|lowest)\b/i],
  // "performance" / "trend" / "history" phrasing all indicate a request to
  // look at a metric over a window, i.e. a trend query.
  ['trend', /\b(trend\w*|over\s+time|history|historical|past|performance)\b/i],
  // 'condition' is the deterministic fallback for direct status questions.
];

const WINDOW_UNIT_SECONDS = { second: 1, minute: 60, hour: 3600, day: 86400 };
const DEFAULT_WINDOW_SEC = 600;

// Set of all known ids for validation (untrusted input: reject unknown ids).
const KNOWN_IDS = new Set(FLEET.map((a) => a.id.toUpperCase()));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyIntent(text) {
  for (const [intent, re] of INTENT_PATTERNS) {
    if (re.test(text)) return intent;
  }
  return 'condition';
}

function extractAssetIds(text) {
  const found = [];
  const re = /\b([A-Za-z]{2,5})[\s-](\d{2,4})\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const id = `${m[1].toUpperCase()}-${m[2]}`;
    if (KNOWN_IDS.has(id) && !found.includes(id)) found.push(id);
  }
  return found;
}

function extractAssetTypes(text) {
  const found = [];
  for (const { type, re } of ASSET_TYPE_LEXICON) {
    if (re.test(text) && !found.includes(type)) found.push(type);
  }
  return found;
}

function extractMetrics(text) {
  const found = [];
  for (const [metric, re] of METRIC_LEXICON) {
    if (re.test(text) && !found.includes(metric)) found.push(metric);
  }
  return found;
}

function extractWindow(text) {
  const m = /\blast\s+(\d+)\s*(second|minute|hour|day)s?\b/i.exec(text);
  if (!m) return DEFAULT_WINDOW_SEC;
  const n = Number(m[1]);
  const unitSec = WINDOW_UNIT_SECONDS[m[2].toLowerCase()];
  if (!Number.isFinite(n) || !unitSec) return DEFAULT_WINDOW_SEC;
  return n * unitSec;
}

function resolveAssets(assetIds, assetTypes) {
  const resolved = [];
  const seen = new Set();
  const add = (a) => {
    if (!seen.has(a.id)) {
      seen.add(a.id);
      resolved.push({ id: a.id, type: a.type });
    }
  };
  for (const id of assetIds) {
    const a = FLEET.find((f) => f.id === id);
    if (a) add(a);
  }
  for (const type of assetTypes) {
    for (const a of FLEET) {
      if (a.type === type) add(a);
    }
  }
  return resolved;
}

function deviationPenalty(value, mean, sigma) {
  // Untrusted input hardening: non-finite readings never corrupt scoring.
  if (!Number.isFinite(value) || !Number.isFinite(mean) || !Number.isFinite(sigma) || sigma <= 0) {
    return 0;
  }
  const z = Math.abs(value - mean) / sigma;
  if (z <= 1) return 0;
  return (z - 1) * 25;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseQuery(text) {
  const q = String(text ?? '');
  const intent = classifyIntent(q);
  const assetIds = extractAssetIds(q);
  const assetTypes = extractAssetTypes(q);
  const metrics = extractMetrics(q);
  const windowSec = extractWindow(q);
  const resolvedAssets = resolveAssets(assetIds, assetTypes);
  return { intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets };
}

export function healthScore(assetType, metrics) {
  const def = ASSET_TYPES[assetType];
  if (!def || !def.nominal || typeof metrics !== 'object' || metrics === null) return 100;
  let penalty = 0;
  for (const [metric, [mean, sigma]] of Object.entries(def.nominal)) {
    const value = metrics[metric];
    if (value === undefined) continue;
    penalty += deviationPenalty(value, mean, sigma);
  }
  const score = 100 - penalty;
  return Math.max(0, Math.min(100, score));
}
