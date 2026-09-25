// F06 — Natural-language asset queries (NLQ)
// Pure ES module, no I/O/network (org standard ADR-001).
// Reads FLEET/ASSET_TYPES from the shared reference; never writes OT state
// (IEC 62443 read-only edge analytics — this module never touches PLC/OPC-UA).
import { FLEET, ASSET_TYPES } from '../../reference/fleet.js';

// ---- static lookup tables --------------------------------------------

// AC-F06-1: ordered, deterministic intent patterns — first match wins.
const INTENT_PATTERNS = [
  { intent: 'car', re: /\bcar\b|corrective action/i },
  { intent: 'work_orders', re: /work order|\bwo\b|\bticket\b/i },
  { intent: 'inventory', re: /spare part|inventory|in stock|on hand|stock level/i },
  { intent: 'ranking', re: /\b(top|rank|worst|best|highest|lowest|most|least|compare)\b/i },
  // "performance" / "over time" / "history" / trend-shaped questions must
  // win before the generic condition/anomaly buckets below (fixes
  // "Show shaft performance for the last 10 minutes" -> 'trend').
  { intent: 'trend', re: /\btrend\b|\bperformance\b|over time|\bhistory\b|historical|increasing|decreasing|change over/i },
  // Condition phrasing is checked before the anomaly keyword list so that
  // "close to surge/failure" style questions resolve to 'condition', not
  // 'anomalies'.
  { intent: 'condition', re: /how is|how are|how's|\bstatus\b|\bcondition\b|close to|\babout to\b|current state|\bperforming\b|health of/i },
  { intent: 'anomalies', re: /anomal(y|ies)|unusual|abnormal|\bspike\b|deviat|\bglitch\b|\bfault\b|\bsurge\b|cavitation|\brisk\b/i },
];

// AC-F06-2: asset type aliasing, disambiguating bare "centrifugal".
const CANONICAL_TYPES = ['motor', 'centrifugal pump', 'shaft', 'centrifugal compressor', 'gearbox'];

// AC-F06-3: metric phrase → canonical metric key.
// "cavitation" resolves to the real telemetry metric that indicates
// cavitation risk (suction pressure), not a synthetic key.
const METRIC_ALIASES = [
  [/bearing temp(erature)?/i, 'bearingTemp'],
  [/winding temp(erature)?/i, 'windingTemp'],
  [/discharge temp(erature)?/i, 'dischargeTemp'],
  [/oil temp(erature)?/i, 'oilTemp'],
  [/misalignment/i, 'misalignment'],
  [/vibration/i, 'vibration'],
  [/\bcurrent\b/i, 'current'],
  [/\brpm\b|\bspeed\b/i, 'rpm'],
  [/power factor/i, 'powerFactor'],
  [/suction pressure/i, 'suctionPressure'],
  [/cavitation/i, 'suctionPressure'],
  [/\bflow\b/i, 'flow'],
  [/\bpressure\b/i, 'pressure'],
  [/\bsurge\b/i, 'surge'],
  [/backlash/i, 'backlash'],
  [/torque/i, 'torque'],
  [/temp(erature)?/i, 'temperature'],
];

const TIME_UNIT_SEC = { second: 1, seconds: 1, minute: 60, minutes: 60, hour: 3600, hours: 3600 };

// Normalized ("motorunit" style, lowercase, no separators/case) FLEET id lookup.
const FLEET_ID_INDEX = new Map(FLEET.map((a) => [a.id.replace(/[\s-]/g, '').toUpperCase(), a.id]));

// Normalize a FLEET/ASSET_TYPES type or label string (camelCase or spaced)
// to the canonical spaced-lowercase form used throughout this module.
function normalizeTypeStr(s) {
  return String(s)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Prefer the human-readable label from ASSET_TYPES (e.g. "Centrifugal Pump")
// as the source of truth for canonical type matching — more robust than
// guessing from the raw `type` key's casing.
const FLEET_NORM_TYPES = FLEET.map((a) => {
  const spec = ASSET_TYPES[a.type];
  const label = spec?.label ?? a.type;
  return { asset: a, normType: normalizeTypeStr(label) };
});

// ---- internal helpers ---------------------------------------------------

function classifyIntent(text) {
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(text)) return intent;
  }
  return 'condition';
}

function extractAssetIds(text) {
  const out = [];
  const re = /([A-Za-z]{2,6})[\s-]?(\d{2,5})/g;
  let m;
  while ((m = re.exec(text))) {
    const key = (m[1] + m[2]).toUpperCase();
    const id = FLEET_ID_INDEX.get(key);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function extractAssetTypes(text) {
  const lower = text.toLowerCase();
  const types = [];
  let ambiguous = false;
  const candidates = [];

  const has = (re) => re.test(lower);

  if (has(/centrifugal pumps?/)) types.push('centrifugal pump');
  else if (has(/centrifugal compressors?/)) types.push('centrifugal compressor');
  else if (has(/\bpumps?\b/)) types.push('centrifugal pump');
  else if (has(/\bcompressors?\b/)) types.push('centrifugal compressor');

  if (has(/\bmotors?\b/)) types.push('motor');
  if (has(/\bshafts?\b/)) types.push('shaft');
  if (has(/\bgearboxe?s?\b/)) types.push('gearbox');

  // Bare "centrifugal" without pump/compressor qualifier is genuinely
  // ambiguous — flag it instead of guessing (spec risk note).
  if (types.length === 0 && has(/\bcentrifugal\b/) && !has(/pump|compressor/)) {
    ambiguous = true;
    candidates.push('centrifugal pump', 'centrifugal compressor');
  }

  const unique = [...new Set(types)];
  return { types: unique, ambiguous, candidates };
}

function extractMetrics(text) {
  const found = [];
  for (const [re, canonical] of METRIC_ALIASES) {
    if (re.test(text) && !found.includes(canonical)) found.push(canonical);
  }
  return found;
}

function extractWindow(text) {
  const m = /last\s+(\d+)\s*(second|seconds|minute|minutes|hour|hours)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return n * TIME_UNIT_SEC[unit];
}

function resolveAssets(ids, types) {
  const resolved = [];
  const push = (asset) => {
    if (!resolved.some((r) => r.id === asset.id)) resolved.push(asset);
  };

  for (const id of ids) {
    const asset = FLEET.find((a) => a.id === id);
    if (asset) push(asset);
  }

  if (types.length > 0) {
    for (const { asset, normType } of FLEET_NORM_TYPES) {
      if (types.includes(normType)) push(asset);
    }
  }

  return resolved;
}

// ---- exports --------------------------------------------------------

export function parseQuery(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new TypeError('parseQuery: text must be a non-empty string');
  }

  const intent = classifyIntent(text);
  const assetIds = extractAssetIds(text);
  const { types: assetTypes, ambiguous, candidates } = extractAssetTypes(text);
  const metrics = extractMetrics(text);
  const windowSec = extractWindow(text);

  let resolvedList;
  if (ambiguous && assetIds.length === 0) {
    // No concrete ids to disambiguate with — surface both candidate types
    // so the caller always has a non-empty slice to ground the answer in.
    resolvedList = resolveAssets(assetIds, candidates);
  } else {
    resolvedList = resolveAssets(assetIds, assetTypes);
  }

  const resolvedAssets = resolvedList.map((a) => a.id);
  resolvedAssets.ambiguous = ambiguous;
  resolvedAssets.candidates = candidates;

  return { intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets };
}

// AC-F06-4: 100 at nominal, drops below 50 under severe deviation.
// deviationScore uses relative distance from the fleet-configured nominal
// mean (ASSET_TYPES[..].nominal[metric][0]); weighted sum is subtracted
// from 100 and clamped to [0,100].
const HEALTH_WEIGHT = 20;

export function healthScore(assetType, metrics) {
  const key = Object.keys(ASSET_TYPES).find(
    (k) => normalizeTypeStr(k) === normalizeTypeStr(assetType) ||
      normalizeTypeStr(ASSET_TYPES[k]?.label ?? '') === normalizeTypeStr(assetType)
  );
  if (!key) throw new TypeError(`healthScore: unknown assetType "${assetType}"`);

  const nominal = ASSET_TYPES[key].nominal ?? {};
  if (metrics == null || typeof metrics !== 'object') {
    throw new TypeError('healthScore: metrics must be an object');
  }

  let penalty = 0;
  for (const [name, value] of Object.entries(metrics)) {
    // IoT security standard: untrusted telemetry — reject non-finite values
    // (NaN/Infinity/non-numeric) rather than silently coercing.
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`healthScore: non-finite metric value for "${name}"`);
    }
    const spec = nominal[name];
    if (!spec) continue; // unknown metric for this asset type — ignored, not scored
    const [mean] = spec;
    const relDev = Math.abs(value - mean) / Math.max(Math.abs(mean), 1e-6);
    penalty += relDev * HEALTH_WEIGHT;
  }

  const score = Math.round(Math.max(0, Math.min(100, 100 - penalty)));
  return score;
}
