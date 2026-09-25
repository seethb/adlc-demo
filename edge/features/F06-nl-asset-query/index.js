// F06 — Natural-language asset queries (NLQ)
// Pure ES module: no I/O, no network, no eval (ADR-001).
// IoT security standard: reject non-finite metric values, unknown asset ids/types/metrics (OWASP IoT I5).
import { FLEET, ASSET_TYPES } from '../../reference/fleet.js';

// ---- static lookup tables (module-scope, immutable) --------------------

// Ordered intent patterns — first match wins (AC-F06-1, deterministic, no ML).
const INTENT_PATTERNS = [
  { intent: 'work_orders', regexes: [/\bwork\s*orders?\b/i, /\bwo\b/i, /\bmaintenance ticket/i] },
  { intent: 'car', regexes: [/\bcorrective action/i, /\bcar\b/i, /\broot cause/i] },
  { intent: 'inventory', regexes: [/\bspare(s)?\b/i, /\binventory\b/i, /\bstock\b/i, /\bin\s+stock\b/i, /\bhow many\b.*\b(spare|part|bearing|seal)/i] },
  { intent: 'ranking', regexes: [/\btop\s+\d*/i, /\bworst\b/i, /\bbest\b/i, /\brank(ed|ing)?\b/i, /\bhighest\b/i, /\blowest\b/i] },
  { intent: 'anomalies', regexes: [/\banomal(y|ies)\b/i, /\brisk\b/i, /\bfault(s)?\b/i, /\balarm(s)?\b/i, /\bcavitation\b/i, /\bdeviat(e|ion)\b/i, /\bunusual\b/i, /\bissue(s)?\b/i, /\bproblem(s)?\b/i] },
  // "performance" combined with time-window phrasing, or explicit trend words, are trend intents.
  { intent: 'trend', regexes: [/\btrend(ing)?\b/i, /\bover time\b/i, /\bhistory\b/i, /\bchanged?\b.*\b(over|since)\b/i, /\bhow has\b/i, /\bperformance\b/i] },
  { intent: 'condition', regexes: [/\bhow is\b/i, /\bstatus\b/i, /\bcondition\b/i, /\bhealth\b/i, /\bperforming\b/i, /.*/] }
];

// Surface form → canonical asset type. Bare "centrifugal" (no pump/compressor) is ambiguous by design.
const ASSET_TYPE_ALIASES = {
  motor: 'motor', motors: 'motor',
  'centrifugal pump': 'centrifugal pump', 'centrifugal pumps': 'centrifugal pump',
  pump: 'centrifugal pump', pumps: 'centrifugal pump',
  shaft: 'shaft', shafts: 'shaft',
  'centrifugal compressor': 'centrifugal compressor', 'centrifugal compressors': 'centrifugal compressor',
  compressor: 'centrifugal compressor', compressors: 'centrifugal compressor',
  gearbox: 'gearbox', gearboxes: 'gearbox'
};

// Phrase → canonical metric key (matches ASSET_TYPES[type].nominal keys).
// "cavitation" (and "cavitation risk") is diagnosed via suction pressure deviation on pumps.
const METRIC_ALIASES = {
  'cavitation risk': 'suctionPressure',
  cavitation: 'suctionPressure',
  'suction pressure': 'suctionPressure',
  vibration: 'vibration',
  'bearing temp': 'bearingTemp', 'bearing temperature': 'bearingTemp',
  'winding temp': 'windingTemp', 'winding temperature': 'windingTemp',
  current: 'current',
  rpm: 'rpm', speed: 'rpm',
  'power factor': 'powerFactor',
  temperature: 'temp', temp: 'temp',
  pressure: 'pressure',
  flow: 'flow'
};

const TIME_UNIT_SEC = {
  second: 1, seconds: 1, sec: 1, secs: 1,
  minute: 60, minutes: 60, min: 60, mins: 60,
  hour: 3600, hours: 3600, hr: 3600, hrs: 3600
};

// Health-score weighting: per-sigma-beyond-tolerance penalty (AC-F06-4).
const HEALTH_PENALTY_PER_SIGMA = 20;
const HEALTH_TOLERANCE_SIGMA = 1;

// ---- internal helpers ----------------------------------------------------

function classifyIntent(text) {
  for (const { intent, regexes } of INTENT_PATTERNS) {
    if (regexes.some((re) => re.test(text))) return intent;
  }
  return 'condition';
}

function extractAssetIds(text) {
  const ids = new Set();
  const known = new Set(FLEET.map((a) => a.id.toUpperCase()));
  const re = /\b([A-Za-z]{2,5})[\s-]?(\d{2,4})\b/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const candidate = `${m[1].toUpperCase()}-${m[2]}`;
    if (known.has(candidate)) ids.add(candidate);
  }
  return [...ids];
}

function extractAssetTypes(text) {
  const lower = text.toLowerCase();
  const types = new Set();
  let ambiguous = false;

  // Longer phrases first to avoid partial matches (e.g. "centrifugal pump" before "pump").
  const phrases = Object.keys(ASSET_TYPE_ALIASES).sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    const re = new RegExp(`\\b${phrase.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(lower)) types.add(ASSET_TYPE_ALIASES[phrase]);
  }

  // Bare "centrifugal" not followed by pump/compressor → ambiguous, no type resolved.
  if (/\bcentrifugal\b(?!\s+(pump|pumps|compressor|compressors))/i.test(lower) && types.size === 0) {
    ambiguous = true;
  }

  return { types: [...types], ambiguous };
}

function extractMetrics(text) {
  const lower = text.toLowerCase();
  const metrics = new Set();
  const phrases = Object.keys(METRIC_ALIASES).sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    const re = new RegExp(`\\b${phrase.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(lower)) metrics.add(METRIC_ALIASES[phrase]);
  }
  return [...metrics];
}

function extractWindow(text) {
  const re = /last\s+(\d+)\s*([a-z]+)/i;
  const m = re.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase().replace(/s$/, ''); // normalize plural
  const sec = TIME_UNIT_SEC[unit] ?? TIME_UNIT_SEC[m[2].toLowerCase()];
  if (!sec || !Number.isFinite(n)) return null;
  return n * sec;
}

function resolveAssets(ids, typeInfo) {
  const { types, ambiguous } = typeInfo;
  let matched;

  if (ids.length > 0) {
    matched = FLEET.filter((a) => ids.includes(a.id.toUpperCase()));
  } else if (types.length > 0) {
    matched = FLEET.filter((a) => types.includes(a.type));
  } else if (ambiguous) {
    matched = FLEET.filter((a) => a.type === 'centrifugal pump' || a.type === 'centrifugal compressor');
  } else {
    // No specific asset/type mentioned: ground on the whole fleet.
    matched = FLEET.slice();
  }

  // resolvedAssets is an array (so `.length` reflects grounding size directly, AC-F06-2)
  // with extra metadata properties attached (arrays are objects in JS).
  const resolved = matched.map((a) => ({ id: a.id, type: a.type, name: a.name }));
  resolved.ids = resolved.map((a) => a.id);
  resolved.ambiguous = ambiguous;
  resolved.candidates = ambiguous ? ['centrifugal pump', 'centrifugal compressor'] : [];
  return resolved;
}

// ---- public API -----------------------------------------------------------

export function parseQuery(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new TypeError('parseQuery: text must be a non-empty string');
  }

  const intent = classifyIntent(text);
  const assetIds = extractAssetIds(text);
  const typeInfo = extractAssetTypes(text);
  const metrics = extractMetrics(text);
  const windowSec = extractWindow(text);
  const resolvedAssets = resolveAssets(assetIds, typeInfo);

  return {
    intent,
    assetIds,
    assetTypes: typeInfo.types,
    metrics,
    windowSec,
    resolvedAssets
  };
}

export function healthScore(assetType, metrics) {
  const type = ASSET_TYPES[assetType];
  if (!type) throw new TypeError(`healthScore: unknown asset type "${assetType}"`);
  if (!metrics || typeof metrics !== 'object') {
    throw new TypeError('healthScore: metrics must be an object');
  }

  let penalty = 0;
  for (const [key, val] of Object.entries(metrics)) {
    // IoT security standard: telemetry is untrusted input — reject non-finite values (OWASP IoT I5).
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new TypeError(`healthScore: non-finite value for metric "${key}"`);
    }
    const nominal = type.nominal?.[key];
    if (!nominal) {
      throw new TypeError(`healthScore: unknown metric "${key}" for asset type "${assetType}"`);
    }
    const [mean, sigma] = nominal;
    if (!sigma) continue;
    const z = Math.abs(val - mean) / sigma;
    if (z > HEALTH_TOLERANCE_SIGMA) {
      penalty += (z - HEALTH_TOLERANCE_SIGMA) * HEALTH_PENALTY_PER_SIGMA;
    }
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));
  return Math.round(score);
}
