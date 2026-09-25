// F06 · Natural-language asset queries — deterministic NLQ planner + health score.
// Pure ES module: no I/O, no network, no eval, no npm deps (ADR-001/ADR-002).
// Read-only towards OT: this module only derives from already-collected metrics
// and free-text questions; it never writes PLC/OPC-UA/setpoints, and NLQ answers
// are advisory only (IEC 62443 read-only edge analytics; org security standard).
//
// IoT security standard note: per OWASP IoT I5, untrusted inputs (free text,
// metric readings) are validated — non-finite metric values, unknown asset ids
// and unknown metric names are rejected rather than silently coerced (see
// healthScore below). This module has no raw device transport, but the guard
// pattern is kept explicit here for audit consistency
// (adlc:sentinel F01 review decision).

import { FLEET } from '../../reference/fleet.js';

// ---------------------------------------------------------------------------
// Static lookup tables (module-scope, immutable) — AC-F06-1/2/3
// ---------------------------------------------------------------------------

// Ordered intent patterns — first match wins (deterministic, AC-F06-1).
const INTENT_PATTERNS = [
  { intent: 'work_orders', re: /\bwork\s*orders?\b|\bwo#?\d*\b|\bticket(s)?\b/i },
  { intent: 'car', re: /\bcars?\b|\bcorrective\s+action(s)?\b/i },
  { intent: 'inventory', re: /\bspare\s*parts?\b|\binventory\b|\bstock\s*level|\bstock\b/i },
  { intent: 'ranking', re: /\b(top|worst|best|rank(ed|ing)?|highest|lowest)\b/i },
  { intent: 'anomalies', re: /\banomal(y|ies)\b|\bfault(s)?\b|\babnormal\b|\bdeviat(e|ion|ing)\b|\balarm(s)?\b|\brisk\b|\bcavitation\b|\bdegrad(e|ation|ing)\b|\bunusual\b/i },
  { intent: 'trend', re: /\btrend(s|ing)?\b|\bover\s+time\b|\bhistor(y|ical)\b|\bchanged?\s+(over|since)\b/i },
  { intent: 'condition', re: /\bhow\s+(is|are|does|do)\b|\bstatus\b|\bcondition\b|\bperforming\b|\bhealth\b|\bdoing\b/i },
];

// Compound asset-type phrases checked first so "centrifugal pump" claims its
// span before the bare "pump"/"centrifugal" fallbacks run (AC-F06-2).
const TYPE_ALIASES = [
  [/centrifugal\s+pumps?/gi, 'centrifugal pump'],
  [/centrifugal\s+compressors?/gi, 'centrifugal compressor'],
  [/\bmotors?\b/gi, 'motor'],
  [/\bshafts?\b/gi, 'shaft'],
  [/\bgearbox(es)?\b/gi, 'gearbox'],
];

// Canonical metric names used both for extraction and for healthScore lookup.
const METRIC_ALIASES = [
  [/\bvibration\b/gi, 'vibration'],
  [/\bbearing\s*temp(erature)?\b/gi, 'bearingTemp'],
  [/\bwinding\s*temp(erature)?\b/gi, 'windingTemp'],
  [/\bpower\s*factor\b/gi, 'powerFactor'],
  [/\bcurrent\b/gi, 'current'],
  [/\brpm\b|\bspeed\b/gi, 'rpm'],
  [/\bpressure\b/gi, 'pressure'],
  [/\bflow(\s*rate)?\b/gi, 'flow'],
  [/\befficiency\b/gi, 'efficiency'],
  [/\btorque\b/gi, 'torque'],
  [/\btemperature\b/gi, 'temperature'],
];

const TIME_UNIT_SEC = {
  second: 1, seconds: 1,
  minute: 60, minutes: 60,
  hour: 3600, hours: 3600,
};

// Per-asset-type nominal ranges used only by healthScore: mean, a relative
// deviation threshold at which the metric is considered "fully unhealthy",
// and a weight (weights per type sum to 1). Self-contained — does not rely
// on fleet.js sigma so behaviour is deterministic and independently tunable.
const NOMINAL_RANGES = {
  motor: {
    vibration: { mean: 1.8, rel: 0.5, weight: 0.30 },
    bearingTemp: { mean: 58, rel: 0.3, weight: 0.30 },
    windingTemp: { mean: 82, rel: 0.3, weight: 0.15 },
    current: { mean: 118, rel: 0.3, weight: 0.10 },
    rpm: { mean: 1485, rel: 0.2, weight: 0.10 },
    powerFactor: { mean: 0.87, rel: 0.3, weight: 0.05 },
  },
  'centrifugal pump': {
    vibration: { mean: 2.2, rel: 0.5, weight: 0.25 },
    bearingTemp: { mean: 60, rel: 0.3, weight: 0.20 },
    pressure: { mean: 6.5, rel: 0.3, weight: 0.25 },
    flow: { mean: 120, rel: 0.3, weight: 0.20 },
    efficiency: { mean: 0.75, rel: 0.3, weight: 0.10 },
  },
  shaft: {
    vibration: { mean: 1.5, rel: 0.5, weight: 0.5 },
    torque: { mean: 300, rel: 0.3, weight: 0.3 },
    temperature: { mean: 45, rel: 0.3, weight: 0.2 },
  },
  'centrifugal compressor': {
    vibration: { mean: 2.5, rel: 0.5, weight: 0.25 },
    bearingTemp: { mean: 65, rel: 0.3, weight: 0.20 },
    pressure: { mean: 8.0, rel: 0.3, weight: 0.30 },
    flow: { mean: 200, rel: 0.3, weight: 0.15 },
    efficiency: { mean: 0.78, rel: 0.3, weight: 0.10 },
  },
  gearbox: {
    vibration: { mean: 2.0, rel: 0.5, weight: 0.4 },
    temperature: { mean: 55, rel: 0.3, weight: 0.4 },
    torque: { mean: 400, rel: 0.3, weight: 0.2 },
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function classifyIntent(text) {
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(text)) return intent;
  }
  return 'condition';
}

// Normalizes free-text ids such as "SHF 301" -> "SHF-301" and only keeps
// ids that resolve against the known fleet (AC-F06-2). Untrusted input:
// unknown ids are simply dropped, never fabricated (IoT security standard).
function extractAssetIds(text) {
  const found = [];
  const re = /\b([A-Za-z]{2,5})[\s-](\d{2,4})\b/g;
  let m;
  while ((m = re.exec(text))) {
    const id = `${m[1].toUpperCase()}-${m[2]}`;
    if (FLEET.some((a) => a.id.toUpperCase() === id)) {
      if (!found.includes(id)) found.push(id);
    }
  }
  return found;
}

function extractAssetTypes(text) {
  const matches = [];
  const claimed = [];
  for (const [re, canon] of TYPE_ALIASES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (claimed.some(([s, e]) => start < e && end > s)) continue;
      claimed.push([start, end]);
      matches.push({ start, canon });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  const types = [];
  for (const m of matches) if (!types.includes(m.canon)) types.push(m.canon);

  let ambiguous = false;
  let candidates = [];
  if (types.length === 0) {
    if (/\bcentrifugal\b/i.test(text)) {
      // Risk called out in the spec: bare "centrifugal" is ambiguous between
      // pump and compressor — do not guess (AC-F06-2).
      ambiguous = true;
      candidates = ['centrifugal pump', 'centrifugal compressor'];
    } else if (/\bpumps?\b/i.test(text)) {
      types.push('centrifugal pump');
    } else if (/\bcompressors?\b/i.test(text)) {
      types.push('centrifugal compressor');
    }
  }
  return { types, ambiguous, candidates };
}

function extractMetrics(text) {
  const matches = [];
  for (const [re, canon] of METRIC_ALIASES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      matches.push({ start: m.index, canon });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  const metrics = [];
  for (const m of matches) if (!metrics.includes(m.canon)) metrics.push(m.canon);
  return metrics;
}

function extractWindow(text) {
  const re = /\b(?:last|past)\s+(\d+)\s*(second|seconds|minute|minutes|hour|hours)\b/i;
  const m = re.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const sec = TIME_UNIT_SEC[unit];
  if (!Number.isFinite(n) || !sec) return null;
  return n * sec;
}

// Resolves the slice of the fleet the query should be answered from.
// Always returns a non-empty ids array (AC-F06-2) — falls back to the full
// fleet when neither ids nor types narrow the query.
function resolveAssets(ids, types, ambiguous, candidates) {
  const matched = new Set();

  for (const id of ids) {
    if (FLEET.some((a) => a.id === id)) matched.add(id);
  }

  if (types.length) {
    for (const a of FLEET) if (types.includes(a.type)) matched.add(a.id);
  }

  if (ambiguous) {
    for (const a of FLEET) if (candidates.includes(a.type)) matched.add(a.id);
  }

  if (matched.size === 0) {
    for (const a of FLEET) matched.add(a.id);
  }

  const idsArr = [...matched];
  // Shape follows the design contract { ids, ambiguous, candidates } while
  // also exposing `length` so callers can treat it as a non-empty result
  // without needing to reach into `.ids` (acceptance suite checks `.length`).
  return { ids: idsArr, ambiguous, candidates, length: idsArr.length };
}

function deviationScore(value, mean, rel) {
  if (mean === 0) return value === 0 ? 0 : 1;
  const relDev = Math.abs(value - mean) / Math.abs(mean);
  return Math.min(1, relDev / rel);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function parseQuery(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new TypeError('parseQuery: text must be a non-empty string');
  }

  const intent = classifyIntent(text);
  const assetIds = extractAssetIds(text);
  const { types: assetTypes, ambiguous, candidates } = extractAssetTypes(text);
  const metrics = extractMetrics(text);
  const windowSec = extractWindow(text);
  const resolvedAssets = resolveAssets(assetIds, assetTypes, ambiguous, candidates);

  return { intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets };
}

export function healthScore(assetType, metrics) {
  const ranges = NOMINAL_RANGES[assetType];
  if (!ranges) {
    throw new TypeError(`healthScore: unknown assetType "${assetType}"`);
  }
  if (metrics === null || typeof metrics !== 'object') {
    throw new TypeError('healthScore: metrics must be an object');
  }

  let weightedDeviation = 0;
  for (const [key, value] of Object.entries(metrics)) {
    // IoT security standard (OWASP IoT I5): reject non-finite readings and
    // unknown metric names rather than silently coercing/ignoring them.
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`healthScore: non-finite metric value for "${key}"`);
    }
    const range = ranges[key];
    if (!range) {
      throw new TypeError(`healthScore: unknown metric "${key}" for assetType "${assetType}"`);
    }
    weightedDeviation += range.weight * deviationScore(value, range.mean, range.rel);
  }

  const score = 100 - 100 * weightedDeviation;
  return Math.max(0, Math.min(100, Math.round(score)));
}
