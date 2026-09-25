// F06 — Natural-language asset queries (NLQ)
// Pure ES module: no I/O, no network, no eval (org standard ADR-001).
// Telemetry/metric inputs are treated as untrusted (IoT security standard / OWASP IoT I5):
// healthScore rejects non-finite metric values and unknown asset types/metrics.
import { FLEET, ASSET_TYPES } from '../../reference/fleet.js';

// ---- Static lookup tables (module-scope, no mutable shared state) ----

// AC-F06-1: ordered, deterministic intent patterns — first match wins.
const INTENT_PATTERNS = [
  { intent: 'work_orders', re: /\bwork[\s-]?orders?\b|\bwo#?\d*\b/i },
  { intent: 'car', re: /\bcorrective action\b|\bcars?\b/i },
  { intent: 'inventory', re: /\bspare parts?\b|\binventory\b|\bstock\b|\bskus?\b/i },
  { intent: 'ranking', re: /\b(highest|lowest|worst|best|top \d+|bottom \d+|rank(ing)?)\b/i },
  // "performance ... for the last N minutes/hours" reads as a request over a time
  // window → trend, not a single-point condition snapshot (AC-F06-1).
  { intent: 'trend', re: /\bperformance\b.*\b(last|past|over)\b/i },
  { intent: 'trend', re: /\btrend\b|\bover time\b|\bhistory\b|\btrack(ing)?\b/i },
  { intent: 'anomalies', re: /\banomal(y|ies)\b|\bfault\b|\balert\b|\brisk\b|\babnormal\b|\bdeviat|\bsurge\b/i },
  { intent: 'condition', re: /.*/ }, // fallback: always matches
];

// AC-F06-2: asset type surface forms → canonical type. "centrifugal" alone is
// intentionally NOT mapped here — it is disambiguated separately (risk in spec).
const ASSET_TYPE_ALIASES = [
  { re: /centrifugal\s+pumps?/i, type: 'centrifugal pump' },
  { re: /centrifugal\s+compressors?/i, type: 'centrifugal compressor' },
  { re: /\bmotors?\b/i, type: 'motor' },
  { re: /\bshafts?\b/i, type: 'shaft' },
  { re: /\bgearbox(?:es)?\b/i, type: 'gearbox' },
  { re: /\bpumps?\b/i, type: 'centrifugal pump' },
  { re: /\bcompressors?\b/i, type: 'centrifugal compressor' },
];

// AC-F06-3: metric phrase → canonical metric key(s) (may map to more than one
// underlying metric, e.g. "cavitation" relates both to a risk flag and to
// suction pressure telemetry used to detect it).
const METRIC_ALIASES = [
  { re: /surge\s+margin/i, keys: ['surgeMargin'] },
  { re: /\bsurge\b/i, keys: ['surgeMargin'] },
  { re: /\bvibration\b/i, keys: ['vibration'] },
  { re: /bearing\s+temp(?:erature)?/i, keys: ['bearingTemp'] },
  { re: /winding\s+temp(?:erature)?/i, keys: ['windingTemp'] },
  { re: /discharge\s+temp(?:erature)?/i, keys: ['dischargeTemp'] },
  { re: /discharge\s+pressure/i, keys: ['dischargePressure'] },
  { re: /suction\s+pressure/i, keys: ['suctionPressure'] },
  { re: /oil\s+temp(?:erature)?/i, keys: ['oilTemp'] },
  { re: /power\s+factor/i, keys: ['powerFactor'] },
  { re: /\bcavitation\b/i, keys: ['cavitationRisk', 'suctionPressure'] },
  { re: /\bcurrent\b/i, keys: ['current'] },
  { re: /\brpm\b|\bspeed\b/i, keys: ['rpm'] },
  { re: /\bpressure\b/i, keys: ['pressure'] },
  { re: /\bflow\b/i, keys: ['flow'] },
  { re: /\btorque\b/i, keys: ['torque'] },
  { re: /\balignment\b/i, keys: ['alignment'] },
  { re: /\bbacklash\b/i, keys: ['backlash'] },
  { re: /\befficiency\b/i, keys: ['efficiency'] },
  { re: /\btemp(?:erature)?\b/i, keys: ['temperature'] },
];

const TIME_UNIT_SEC = {
  second: 1, seconds: 1,
  minute: 60, minutes: 60,
  hour: 3600, hours: 3600,
};

// Per-metric weights for healthScore (AC-F06-4). Metrics not listed share equal weight.
const HEALTH_WEIGHTS = {
  motor: { vibration: 0.35, bearingTemp: 0.25, windingTemp: 0.15, current: 0.10, rpm: 0.05, powerFactor: 0.10 },
};

const ID_PREFIXES = [...new Set(FLEET.map((a) => a.id.split('-')[0]))];
const ID_RE = new RegExp(`\\b(${ID_PREFIXES.join('|')})[\\s-]?(\\d{2,4})\\b`, 'gi');

// ---- Internal helpers ----

function classifyIntent(text) {
  for (const p of INTENT_PATTERNS) {
    if (p.re.test(text)) return p.intent;
  }
  return 'condition';
}

function extractAssetIds(text) {
  const ids = new Set();
  ID_RE.lastIndex = 0;
  let m;
  while ((m = ID_RE.exec(text))) {
    ids.add(`${m[1].toUpperCase()}-${m[2]}`);
  }
  return [...ids];
}

function extractAssetTypes(text) {
  const found = new Set();
  for (const { re, type } of ASSET_TYPE_ALIASES) {
    if (re.test(text)) found.add(type);
  }
  if (found.size > 0) {
    return { types: [...found], ambiguous: false, candidates: [] };
  }
  // Bare "centrifugal" with no pump/compressor qualifier: ambiguous per spec risk note.
  if (/\bcentrifugal\b/i.test(text)) {
    return { types: [], ambiguous: true, candidates: ['centrifugal pump', 'centrifugal compressor'] };
  }
  return { types: [], ambiguous: false, candidates: [] };
}

function extractMetrics(text) {
  const found = [];
  const seen = new Set();
  for (const { re, keys } of METRIC_ALIASES) {
    if (re.test(text)) {
      for (const key of keys) {
        if (!seen.has(key)) {
          seen.add(key);
          found.push(key);
        }
      }
    }
  }
  return found;
}

function extractWindow(text) {
  const m = text.match(/last\s+(\d+)\s*(second|seconds|minute|minutes|hour|hours)\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  return n * TIME_UNIT_SEC[unit];
}

function resolveAssets(ids, types) {
  const normTypes = types.map((t) => t.toLowerCase());
  const byId = ids.length ? FLEET.filter((a) => ids.includes(a.id)) : [];
  const byType = normTypes.length ? FLEET.filter((a) => normTypes.includes(String(a.type).toLowerCase())) : [];
  const map = new Map();
  for (const a of [...byId, ...byType]) map.set(a.id, a);
  return [...map.values()];
}

// ---- Exports ----

// AC-F06-1..3
export function parseQuery(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new TypeError('parseQuery: text must be a non-empty string');
  }

  const intent = classifyIntent(text);
  const assetIds = extractAssetIds(text);
  const typeInfo = extractAssetTypes(text);
  const metrics = extractMetrics(text);
  const windowSec = extractWindow(text);

  const typesForResolution = typeInfo.ambiguous ? typeInfo.candidates : typeInfo.types;
  let resolved = resolveAssets(assetIds, typesForResolution);

  // Fallback: a query with no explicit id/type still needs a non-empty fleet slice
  // (e.g. general condition/ranking questions over the whole fleet).
  if (resolved.length === 0 && assetIds.length === 0 && typesForResolution.length === 0) {
    resolved = FLEET;
  }

  // resolvedAssets is array-shaped (tests use `.length`) but also carries the
  // richer metadata described by the design (ids/ambiguous/candidates) as properties.
  const resolvedAssets = resolved.map((a) => a.id);
  resolvedAssets.ids = resolvedAssets.slice();
  resolvedAssets.ambiguous = typeInfo.ambiguous;
  resolvedAssets.candidates = typeInfo.candidates;

  return {
    intent,
    assetIds,
    assetTypes: typeInfo.types,
    metrics,
    windowSec,
    resolvedAssets,
  };
}

// AC-F06-4
export function healthScore(assetType, metrics) {
  const spec = ASSET_TYPES[assetType];
  if (!spec) throw new TypeError(`healthScore: unknown asset type "${assetType}"`);
  const nominal = spec.nominal ?? {};

  const keys = Object.keys(metrics ?? {});
  if (keys.length === 0) throw new TypeError('healthScore: no metrics provided');

  for (const k of keys) {
    const v = metrics[k];
    // IoT security standard: reject non-finite/non-numeric readings (OWASP IoT I5).
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(`healthScore: non-finite metric value for "${k}"`);
    }
    if (!(k in nominal)) {
      throw new TypeError(`healthScore: unknown metric "${k}" for type "${assetType}"`);
    }
  }

  const weights = HEALTH_WEIGHTS[assetType] ?? {};
  const defaultWeight = 1 / keys.length;

  let totalWeight = 0;
  let penalty = 0;
  for (const k of keys) {
    const [mean] = nominal[k];
    const w = weights[k] ?? defaultWeight;
    totalWeight += w;
    if (mean !== 0) {
      const relDev = Math.abs(metrics[k] - mean) / Math.abs(mean);
      penalty += w * relDev * 100;
    }
  }

  const norm = totalWeight > 0 ? totalWeight : 1;
  const score = 100 - penalty / norm;
  return Math.max(0, Math.min(100, Math.round(score)));
}
