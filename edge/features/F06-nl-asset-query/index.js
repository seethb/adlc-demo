// F06 · Natural-language asset queries
// Pure, side-effect-free query planner + health scoring.
// Per IoT security standard (OWASP IoT I5): telemetry/metrics passed into
// healthScore are treated as untrusted input — non-finite values are ignored
// rather than corrupting the score. This module is strictly read-only
// towards OT (IEC 62443): it never writes back to the fleet, only reads the
// in-memory FLEET/ASSET_TYPES reference data (AC-F06-2, AC-F06-4).
import { FLEET, ASSET_TYPES } from '../../reference/fleet.js';

// ---- Lexicons -------------------------------------------------------------

// Asset type lexicon: longest/most-specific phrases first so "centrifugal
// pump" / "centrifugal compressor" win over a bare "centrifugal" (AC-F06-2).
const ASSET_TYPE_LEXICON = [
  { re: /\bcentrifugal\s+pump(s)?\b/i, type: 'centrifugal pump' },
  { re: /\bcentrifugal\s+compressor(s)?\b/i, type: 'centrifugal compressor' },
  { re: /\bmotor(s)?\b/i, type: 'motor' },
  { re: /\bshaft(s)?\b/i, type: 'shaft' },
  { re: /\bgearbox(es)?\b/i, type: 'gearbox' },
];

const METRIC_LEXICON = [
  { re: /\bvibration\b/i, metric: 'vibration' },
  { re: /\bbearing\s*temp(erature)?\b/i, metric: 'bearingTemp' },
  { re: /\bwinding\s*temp(erature)?\b/i, metric: 'windingTemp' },
  { re: /\btemp(erature)?\b/i, metric: 'temperature' },
  // Cavitation risk is diagnosed via suction pressure deviation — surface
  // both the domain symptom (cavitation) and the underlying metric
  // (suctionPressure) that a query slice needs (AC-F06-3).
  { re: /\bcavitat(ion|ing)\b/i, metric: 'suctionPressure' },
  { re: /\bcavitat(ion|ing)\b/i, metric: 'cavitation' },
  { re: /\bsuction\s*pressure\b/i, metric: 'suctionPressure' },
  { re: /\bpressure\b/i, metric: 'pressure' },
  { re: /\bflow\b/i, metric: 'flow' },
  { re: /\bcurrent\b/i, metric: 'current' },
  { re: /\brpm\b/i, metric: 'rpm' },
  { re: /\bspeed\b/i, metric: 'rpm' },
  { re: /\bpower\s*factor\b/i, metric: 'powerFactor' },
  { re: /\bmisalign(ment|ed)?\b/i, metric: 'misalignment' },
  { re: /\bnoise\b/i, metric: 'noise' },
  { re: /\btorque\b/i, metric: 'torque' },
  { re: /\bload\b/i, metric: 'load' },
];

// Ordered intent rules — order matters: anomaly/fault language must win
// over generic "which ..." ranking language, and trend/time-series phrasing
// ("for the last N minutes", "over the last N minutes") must win over the
// generic "condition" fallback (AC-F06-1).
const INTENT_PATTERNS = [
  { intent: 'work_orders', re: /\bwork\s*orders?\b|\bwo\b|\bticket(s)?\b/i },
  { intent: 'car', re: /\bcorrective\s+action(s)?\b|\bcar\b/i },
  { intent: 'anomalies', re: /\banomal(y|ies)\b|\brisk\b|\balert(s)?\b|\bfault(s)?\b|\bdeviat|\babnormal|\bfailure|\bcavitat|\bmisalign/i },
  { intent: 'ranking', re: /\btop\b|\brank(ing)?\b|\bbest\b|\bworst\b|\bwhich .*(most|highest|lowest)\b|\bcompare\b/i },
  {
    intent: 'trend',
    re: /\btrend\b|\bover\s+the\s+last\b|\bhistory\b|\bchange(d)?\s+over\s+time\b|\b(for|over)\s+the\s+last\s+\d+\s*(second|sec|minute|min|hour|hr)/i,
  },
  { intent: 'inventory', re: /\bstock\b|\bspare(s)?\b|\binventory\b|\bpart(s)?\b/i },
];

// ---- Extraction helpers -----------------------------------------------------

function extractAssetIds(text) {
  const re = /\b([A-Z]{2,4})[- ](\d{2,4})\b/g;
  const out = new Set();
  let m;
  const upper = text.toUpperCase();
  while ((m = re.exec(upper))) {
    out.add(`${m[1]}-${m[2]}`);
  }
  return [...out];
}

function extractAssetTypes(text) {
  const out = [];
  for (const { re, type } of ASSET_TYPE_LEXICON) {
    if (re.test(text) && !out.includes(type)) out.push(type);
  }
  return out;
}

function extractMetrics(text) {
  const out = [];
  for (const { re, metric } of METRIC_LEXICON) {
    if (re.test(text) && !out.includes(metric)) out.push(metric);
  }
  return out;
}

function extractWindow(text) {
  const m = /\blast\s+(\d+)\s*(second|sec|minute|min|hour|hr)s?\b/i.exec(text);
  if (!m) return 600;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return 600;
  const unit = m[2].toLowerCase();
  if (unit.startsWith('sec')) return n;
  if (unit.startsWith('min')) return n * 60;
  if (unit.startsWith('hour') || unit.startsWith('hr')) return n * 3600;
  return 600;
}

function classifyIntent(text) {
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(text)) return intent;
  }
  return 'condition';
}

// Case-insensitive, direction-agnostic match between an extracted type
// phrase (e.g. "centrifugal pump") and a fleet asset's recorded type
// string, tolerating case or label/key spelling differences between the
// reference fleet data and the lexicon (AC-F06-2).
function typeMatches(extractedType, fleetType) {
  if (!fleetType) return false;
  const a = String(extractedType).toLowerCase().trim();
  const b = String(fleetType).toLowerCase().trim();
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

function resolveAssets(assetIds, assetTypes) {
  const out = [];
  const seen = new Set();
  const idsUpper = assetIds.map((i) => i.toUpperCase());
  for (const a of FLEET) {
    const matchesId = idsUpper.includes(String(a.id).toUpperCase());
    const matchesType = assetTypes.some((t) => typeMatches(t, a.type));
    if ((matchesId || matchesType) && !seen.has(a.id)) {
      seen.add(a.id);
      out.push({ id: a.id, type: a.type });
    }
  }
  return out;
}

// ---- Public API -------------------------------------------------------------

export function parseQuery(text) {
  const safeText = typeof text === 'string' ? text : '';
  const intent = classifyIntent(safeText);
  const assetIds = extractAssetIds(safeText);
  const assetTypes = extractAssetTypes(safeText);
  const metrics = extractMetrics(safeText);
  const windowSec = extractWindow(safeText);
  const resolvedAssets = resolveAssets(assetIds, assetTypes);
  return { intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets };
}

// Pure deviation-based penalty: severe deviations (large z-score) saturate
// quickly so a single badly-off metric is enough to push health well below
// the 50 threshold (AC-F06-4), while nominal metrics contribute ~0.
function deviationPenalty(value, mean, sigma) {
  if (!Number.isFinite(value) || !Number.isFinite(mean) || !Number.isFinite(sigma) || sigma <= 0) return 0;
  const z = Math.abs(value - mean) / sigma;
  return Math.min(100, z * z * 5);
}

export function healthScore(assetType, metrics) {
  const spec = ASSET_TYPES?.[assetType];
  if (!spec || !spec.nominal || typeof metrics !== 'object' || metrics === null) return 100;
  let penalty = 0;
  for (const [metric, [mean, sigma]] of Object.entries(spec.nominal)) {
    const value = metrics[metric];
    if (value === undefined) continue;
    // Untrusted-input guard (AC-F02-6 style discipline): ignore non-finite
    // readings rather than letting them corrupt the score.
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    penalty += deviationPenalty(value, mean, sigma);
  }
  return Math.max(0, Math.min(100, 100 - penalty));
}
