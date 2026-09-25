// F06 · Natural-language asset queries (NLQ)
// Pure ES module — no I/O, no network, no eval (ADR-001 org standard).
// Reads only static fleet reference data; never writes PLC/OPC-UA/setpoints
// (IEC 62443 — edge analytics is read-only towards OT).
import { FLEET, ASSET_TYPES } from '../../reference/fleet.js';

// ---------------------------------------------------------------------------
// Static lookup tables (module-scope, immutable) — AC-F06-1..3
// ---------------------------------------------------------------------------

// Ordered intent patterns — first match wins, deterministic (AC-F06-1).
// Time-window queries ("last 10 minutes") without another stronger intent
// are treated as trend queries (history over a window), matched separately
// below via the extracted windowSec, not purely by regex.
const INTENT_PATTERNS = [
  { intent: 'anomalies', re: /anomal|fault|alarm|deviat|abnormal/i },
  { intent: 'car', re: /\bcar\b|corrective action/i },
  { intent: 'work_orders', re: /work order|maintenance ticket|open ticket|schedule[d]? maintenance/i },
  { intent: 'inventory', re: /spare|stock|inventory|parts? (on hand|available)/i },
  { intent: 'ranking', re: /which .* (highest|lowest|worst|best)|top \d+|rank(ed|ing)?|worst performing/i },
  { intent: 'trend', re: /trend|over (the )?(last|past)\s+\d+\s*(day|days|week|weeks)|history|compare (to|with)|yesterday/i }
  // fallback handled explicitly in classifyIntent: 'condition'
];

// Asset-type surface forms → canonical type (AC-F06-2). Compound forms first.
const ASSET_TYPE_ALIASES = [
  { re: /centrifugal pumps?/i, type: 'centrifugal pump' },
  { re: /centrifugal compressors?/i, type: 'centrifugal compressor' },
  { re: /\bmotors?\b/i, type: 'motor' },
  { re: /\bgearbox(es)?\b/i, type: 'gearbox' },
  { re: /\bshafts?\b/i, type: 'shaft' },
  { re: /\bpumps?\b/i, type: 'centrifugal pump' },
  { re: /\bcompressors?\b/i, type: 'centrifugal compressor' }
];

// Metric phrase → canonical metric key (AC-F06-3).
const METRIC_ALIASES = [
  { re: /bearing temp(erature)?/i, metric: 'bearingTemp' },
  { re: /winding temp(erature)?/i, metric: 'windingTemp' },
  { re: /vibration/i, metric: 'vibration' },
  { re: /power factor/i, metric: 'powerFactor' },
  { re: /current/i, metric: 'current' },
  { re: /\brpm\b|speed/i, metric: 'rpm' },
  // Cavitation risk is driven by low suction pressure — map to suctionPressure
  // rather than a synthetic "cavitation" metric (AC-F06-3).
  { re: /cavitation/i, metric: 'suctionPressure' },
  { re: /suction pressure/i, metric: 'suctionPressure' },
  { re: /flow/i, metric: 'flow' },
  { re: /pressure/i, metric: 'pressure' },
  { re: /misalignment/i, metric: 'misalignment' },
  { re: /efficiency/i, metric: 'efficiency' },
  // "surge" / "surge margin" / "close to surge" — compressor surge margin.
  { re: /surge/i, metric: 'surgeMargin' },
  { re: /temperature/i, metric: 'temperature' }
];

const TIME_UNIT_SEC = {
  second: 1, seconds: 1,
  minute: 60, minutes: 60,
  hour: 3600, hours: 3600
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Time windows bias classification towards "trend" (a query over a window is
// asking about history), unless a stronger, more specific intent matched
// first — AC-F06-1, AC-F06-3.
function classifyIntent(text, windowSec) {
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(text)) return intent;
  }
  if (windowSec != null) return 'trend';
  return 'condition';
}

// Normalizes free-text ids ("SHF 301" -> "SHF-301") — AC-F06-2.
function extractAssetIds(text) {
  const re = /\b([A-Z]{2,5})[\s-](\d{2,5})\b/g;
  const ids = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    ids.push(`${m[1]}-${m[2]}`);
  }
  return [...new Set(ids)];
}

// Resolves canonical asset types; disambiguates bare "centrifugal" — AC-F06-2.
function extractAssetTypes(text) {
  const types = new Set();
  for (const { re, type } of ASSET_TYPE_ALIASES) {
    if (re.test(text)) types.add(type);
  }
  const hasBareCentrifugal = /centrifugal/i.test(text) &&
    !/centrifugal pumps?/i.test(text) && !/centrifugal compressors?/i.test(text);

  let ambiguous = false;
  let candidates = [];
  if (hasBareCentrifugal && types.size === 0) {
    ambiguous = true;
    candidates = ['centrifugal pump', 'centrifugal compressor'];
  }
  return { types: [...types], ambiguous, candidates };
}

// Extracts referenced metrics — AC-F06-3.
function extractMetrics(text) {
  const metrics = new Set();
  for (const { re, metric } of METRIC_ALIASES) {
    if (re.test(text)) metrics.add(metric);
  }
  return [...metrics];
}

// Extracts "last N minute(s)/hour(s)/second(s)" time windows — AC-F06-3.
function extractWindow(text) {
  const m = /\b(?:last|past)\s+(\d+)\s*(second|seconds|minute|minutes|hour|hours)\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return n * TIME_UNIT_SEC[unit];
}

// Selects the fleet slice matching ids/types/ambiguity — AC-F06-2.
// Returned as an array (test uses .length) carrying extra metadata props
// (.ids/.ambiguous/.candidates) so both consumers can use it.
function resolveAssets(ids, types, ambiguous, candidates) {
  let matched = [];
  if (ids.length) {
    matched = FLEET.filter(a => ids.includes(a.id));
  } else if (types.length) {
    matched = FLEET.filter(a => types.includes(a.type));
  } else if (ambiguous) {
    matched = FLEET.filter(a => candidates.includes(a.type));
  } else {
    matched = FLEET.slice(); // whole-fleet queries (e.g. rankings)
  }
  const result = matched;
  result.ids = matched.map(a => a.id);
  result.ambiguous = ambiguous;
  result.candidates = candidates;
  return result;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

// AC-F06-1, AC-F06-2, AC-F06-3
export function parseQuery(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new TypeError('parseQuery requires a non-empty string');
  }

  const assetIds = extractAssetIds(text);
  const { types: assetTypes, ambiguous, candidates } = extractAssetTypes(text);
  const metrics = extractMetrics(text);
  const windowSec = extractWindow(text);
  const intent = classifyIntent(text, windowSec);
  const resolvedAssets = resolveAssets(assetIds, assetTypes, ambiguous, candidates);

  return { intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets };
}

// AC-F06-4: health = 100 minus weighted deviation from nominal, clamped [0,100].
export function healthScore(assetType, metrics) {
  const def = ASSET_TYPES[assetType];
  if (!def) throw new TypeError(`Unknown asset type: ${assetType}`);
  if (metrics == null || typeof metrics !== 'object') {
    throw new TypeError('metrics must be an object');
  }

  let sumSquares = 0;
  for (const [key, val] of Object.entries(metrics)) {
    // IoT security standard: telemetry is untrusted input — reject
    // non-finite / non-numeric values (OWASP IoT I5).
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new TypeError(`Non-finite metric value for ${key}`);
    }
    const nominal = def.nominal?.[key];
    if (!nominal) {
      // Unknown metric for this asset type — reject per IoT security standard.
      throw new TypeError(`Unknown metric ${key} for asset type ${assetType}`);
    }
    const [mean, sigma] = nominal;
    if (sigma > 0) {
      const z = (val - mean) / sigma;
      sumSquares += z * z;
    }
  }

  const raw = 100 - 10 * Math.sqrt(sumSquares);
  return Math.round(Math.max(0, Math.min(100, raw)));
}
