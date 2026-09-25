// F06 — Natural-language asset queries (NLQ)
// Pure planner + health scorer. No I/O, no network, no eval (org standard ADR-001).
// Grounded fleet metadata is imported from the reference fleet definitions only.
import { FLEET, ASSET_TYPES } from '../../reference/fleet.js';

// ---- normalize -------------------------------------------------------
function normalize(text) {
  return String(text ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

// ---- intent resolution (AC-F06-1) -------------------------------------
// Fixed-order rule cascade; first match wins. Bounded/anchored regexes
// only — text is untrusted free input, never eval'd (IoT security standard).
const INTENT_RULES = [
  { intent: 'inventory', re: /\b(parts?|spares?|stock|inventory|reorder)\b/ },
  { intent: 'work_orders', re: /\b(work\s?orders?|wos?|maintenance backlog)\b/ },
  { intent: 'car', re: /\b(cars?|corrective|root cause)\b/ },
  { intent: 'anomalies', re: /\b(anomal\w*|alarms?|alerts?|fault\w*|risk)\b/ },
  { intent: 'trend', re: /\b(trend|history|over time)\b|\blast\s+\d+\s*\w*/ },
  { intent: 'ranking', re: /\b(worst|rank\w*|most|healthiest|least)\b/ },
];

function resolveIntent(normText) {
  for (const rule of INTENT_RULES) {
    if (rule.re.test(normText)) return rule.intent;
  }
  return 'condition';
}

// ---- asset ids (AC-F06-2) ----------------------------------------------
// Matches canonical dashed ids (MTR-101) and spaced forms (SHF 301),
// case-preserved on the original text.
const ASSET_ID_RE = /\b([A-Z]{2,4})[-\s](\d{2,4})\b/g;

function resolveAssetIds(originalText) {
  const ids = [];
  let m;
  ASSET_ID_RE.lastIndex = 0;
  while ((m = ASSET_ID_RE.exec(originalText)) !== null) {
    const canonical = `${m[1]}-${m[2]}`;
    if (!ids.includes(canonical)) ids.push(canonical);
  }
  return ids;
}

// ---- asset types (AC-F06-2) ---------------------------------------------
function resolveAssetTypes(normText) {
  const types = [];
  const has = (re) => re.test(normText);

  if (has(/\bmotors?\b/)) types.push('motor');

  const hasCompressor = has(/\bcompressors?\b/);
  const hasPumpWord = has(/\bpumps?\b/);
  const hasCentrifugal = has(/\bcentrifugal\b/);

  if (hasCompressor) types.push('centrifugal_compressor');
  // "pump" or bare "centrifugal" (without compressor) resolves to centrifugal_pump;
  // "centrifugal" alone does not add pump if compressor is already present.
  if (hasPumpWord || (hasCentrifugal && !hasCompressor)) {
    if (!types.includes('centrifugal_pump')) types.push('centrifugal_pump');
  }

  if (has(/\bshafts?\b/)) types.push('shaft');
  if (has(/\bgear\s?box(es)?\b/)) types.push('gearbox');

  return types;
}

// ---- metrics (AC-F06-3) --------------------------------------------------
const METRIC_MAP = [
  { re: /\b(vibrat\w*|shak\w*)\b/, metric: 'vibration' },
  { re: /\bbearing\w*\b/, metric: 'bearingTemp' },
  { re: /\b(winding\w*|stator)\b/, metric: 'windingTemp' },
  { re: /\b(current|amps?|load)\b/, metric: 'current' },
  { re: /\b(rpm|speed)\b/, metric: 'rpm' },
  { re: /\bflow\b/, metric: 'flow' },
  { re: /\b(suction|npsh|cavitat\w*)\b/, metric: 'suctionPressure' },
  { re: /\b(discharge pressure|head)\b/, metric: 'dischargePressure' },
  { re: /\b(misalign\w*|alignment)\b/, metric: 'misalignment' },
  { re: /\b(orbit|runout)\b/, metric: 'shaftOrbit' },
  { re: /\btorque\b/, metric: 'torque' },
  { re: /\bsurge\b/, metric: 'surgeMargin' },
  { re: /\boil\b/, metric: 'oilTemp' },
  { re: /\b(particle\w*|debris)\b/, metric: 'particleCount' },
];

function resolveMetrics(normText) {
  const metrics = [];
  for (const { re, metric } of METRIC_MAP) {
    if (re.test(normText) && !metrics.includes(metric)) metrics.push(metric);
  }
  return metrics;
}

// ---- time window (AC-F06-3) ---------------------------------------------
const WINDOW_UNITS = {
  s: 1, sec: 1, seconds: 1,
  m: 60, min: 60, minutes: 60,
  h: 3600, hours: 3600,
};

function resolveWindow(normText) {
  const m = normText.match(/\blast\s+(\d+)\s*(s|sec|seconds|m|min|minutes|h|hours)\b/);
  if (!m) return 300;
  const n = parseInt(m[1], 10);
  const unit = WINDOW_UNITS[m[2]] ?? 1;
  return n * unit;
}

// ---- asset resolution ----------------------------------------------------
function resolveAssets(assetIds, assetTypes, fleet) {
  if (assetIds.length > 0) return assetIds;
  if (assetTypes.length > 0) {
    const matched = fleet.filter((a) => assetTypes.includes(a.type)).map((a) => a.id);
    if (matched.length > 0) return matched;
  }
  return fleet.map((a) => a.id);
}

// ---- exported: parseQuery (AC-F06-1..3) -----------------------------------
export function parseQuery(text, fleet = FLEET) {
  const normText = normalize(text);
  const intent = resolveIntent(normText);
  const assetIds = resolveAssetIds(String(text ?? ''));
  const assetTypes = resolveAssetTypes(normText);
  const metrics = resolveMetrics(normText);
  const windowSec = resolveWindow(normText);
  const resolvedAssets = resolveAssets(assetIds, assetTypes, fleet);

  return { intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets };
}

// ---- exported: healthScore (AC-F06-4) -------------------------------------
// Deviation-weighted scoring against reference nominal ranges (mean, sigma).
// Half-sigma tolerance band absorbs normal sensor noise; deviations beyond
// that accumulate and are mapped through an exponential decay so a single
// severe deviation (or a couple of moderate ones) drives the score well
// below 50, while nominal readings stay pinned at 100.
export function healthScore(assetType, metrics) {
  const typeDef = ASSET_TYPES?.[assetType];
  if (!typeDef?.nominal || !metrics || typeof metrics !== 'object') return 100;

  let sumD = 0;
  let counted = 0;

  for (const [metric, value] of Object.entries(metrics)) {
    const range = typeDef.nominal[metric];
    if (!range) continue;
    const [mean, sigma] = range;
    if (!Number.isFinite(value) || !Number.isFinite(mean) || !Number.isFinite(sigma) || sigma <= 0) continue;
    const z = Math.abs((value - mean) / sigma);
    const d = Math.max(0, z - 0.5);
    sumD += d;
    counted += 1;
  }

  if (counted === 0) return 100;

  const score = 100 * Math.exp(-sumD / 2);
  return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
}
