// F06 · Natural-language asset queries (NLQ)
// Pure, side-effect-free ES module. No I/O, no network, no env access (ADR-001).
// Per IoT security standard (OWASP IoT I5): telemetry passed to healthScore is treated
// as untrusted input — non-finite metric values (NaN/Infinity/non-numbers) are rejected
// and never scored (see AC-F02-6 precedent applied defensively here too).
// Read-only towards OT: this module never writes/commands anything (IEC 62443 zones).

import { FLEET, ASSET_TYPES } from '../../reference/fleet.js';

// ---------------------------------------------------------------------------
// Lexicons (static, immutable)
// ---------------------------------------------------------------------------

// AC-F06-2: known asset types, with disambiguation — "centrifugal" alone never
// matches; it must be immediately followed by "pump" or "compressor".
const ASSET_TYPE_LEXICON = [
  { label: 'motor', pattern: /\bmotors?\b/i },
  { label: 'centrifugal pump', pattern: /\bcentrifugal\s+pumps?\b/i },
  { label: 'shaft', pattern: /\bshafts?\b/i },
  { label: 'centrifugal compressor', pattern: /\bcentrifugal\s+compressors?\b/i },
  { label: 'gearbox', pattern: /\bgearbox(?:es)?\b/i },
];

// AC-F06-3: metric keywords, most specific first so e.g. "bearing temperature"
// resolves to bearingTemp rather than the generic "temperature".
const METRIC_LEXICON = [
  { name: 'bearingTemp', pattern: /\bbearing\s*temp(?:erature)?\b/i },
  { name: 'windingTemp', pattern: /\bwinding\s*temp(?:erature)?\b/i },
  { name: 'suctionPressure', pattern: /\bsuction\s*pressure\b|\bcavitation\b/i },
  { name: 'vibration', pattern: /\bvibration\b/i },
  { name: 'temperature', pattern: /\btemp(?:erature)?\b/i },
  { name: 'pressure', pattern: /\bpressure\b/i },
  { name: 'flow', pattern: /\bflow(?:\s*rate)?\b/i },
  { name: 'current', pattern: /\bcurrent\b/i },
  { name: 'rpm', pattern: /\brpm\b|\bspeed\b/i },
  { name: 'powerFactor', pattern: /\bpower\s*factor\b/i },
  { name: 'humidity', pattern: /\bhumidity\b/i },
  { name: 'torque', pattern: /\btorque\b/i },
  { name: 'efficiency', pattern: /\befficiency\b/i },
  { name: 'noise', pattern: /\bnoise\b/i },
];

// AC-F06-1: deterministic intent patterns, evaluated in order (first match wins).
const INTENT_PATTERNS = [
  { intent: 'car', pattern: /\bcars?\b|corrective\s+action/i },
  { intent: 'work_orders', pattern: /\bwork\s*orders?\b|maintenance\s+ticket|\bwo[-\s#]?\d/i },
  { intent: 'inventory', pattern: /\bspare\s*parts?\b|\binventory\b|\bstock\b|\bsku\b|\breorder\b/i },
  { intent: 'anomalies', pattern: /\banomal(?:y|ies)\b|\babnormal\b|\bfault(?:s)?\b|\bdeviation(?:s)?\b|\brisk\b|\bcavitation\b/i },
  { intent: 'ranking', pattern: /\b(which|top|rank(?:ing)?|worst|best|highest|lowest|most|least)\b/i },
  { intent: 'trend', pattern: /\btrend(?:ing)?\b|\bhistory\b|\bover\s+time\b|\bchang(?:e|ed|ing)\b|\bperformance\b/i },
];

const TIME_UNIT_SECONDS = {
  second: 1, sec: 1,
  minute: 60, min: 60,
  hour: 3600, hr: 3600,
  day: 86400,
  week: 604800,
};

const DEFAULT_WINDOW_SEC = 600;

// ---------------------------------------------------------------------------
// Fleet index helpers
// ---------------------------------------------------------------------------

const FLEET_ID_SET = new Set(FLEET.map((a) => String(a.id).toUpperCase()));

function typeLabel(typeKey) {
  const meta = ASSET_TYPES[typeKey];
  if (meta && meta.label) return meta.label;
  return String(typeKey).replace(/_/g, ' ');
}

// Resolves a human-facing type label (e.g. "centrifugal pump") to the internal
// ASSET_TYPES key (e.g. "centrifugal_pump"), tolerant of label mismatches.
function resolveTypeKey(assetTypeLabel) {
  if (ASSET_TYPES[assetTypeLabel]) return assetTypeLabel;
  const snake = assetTypeLabel.replace(/\s+/g, '_').toLowerCase();
  if (ASSET_TYPES[snake]) return snake;
  const lower = assetTypeLabel.toLowerCase();
  for (const key of Object.keys(ASSET_TYPES)) {
    if (typeLabel(key).toLowerCase() === lower) return key;
    if (key.toLowerCase() === lower) return key;
  }
  return snake;
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

function classifyIntent(text) {
  for (const { intent, pattern } of INTENT_PATTERNS) {
    if (pattern.test(text)) return intent;
  }
  return 'condition';
}

// AC-F06-2: resolves asset ids incl. "SHF 301" -> "SHF-301"; unknown candidate
// ids (not in the fleet) are silently dropped rather than guessed.
function extractAssetIds(text) {
  const found = [];
  const re = /\b([A-Za-z]{2,5})[\s-](\d{2,4})\b/g;
  let m;
  while ((m = re.exec(text))) {
    const candidate = `${m[1].toUpperCase()}-${m[2]}`;
    if (FLEET_ID_SET.has(candidate) && !found.includes(candidate)) {
      found.push(candidate);
    }
  }
  return found;
}

function extractAssetTypes(text) {
  const found = [];
  for (const { label, pattern } of ASSET_TYPE_LEXICON) {
    if (pattern.test(text) && !found.includes(label)) found.push(label);
  }
  return found;
}

function extractMetrics(text) {
  const found = [];
  for (const { name, pattern } of METRIC_LEXICON) {
    if (pattern.test(text) && !found.includes(name)) found.push(name);
  }
  return found;
}

// AC-F06-3: relative time windows, e.g. "last 10 minutes" -> 600.
function extractWindow(text) {
  const numeric = /last\s+(\d+)\s*(second|sec|minute|min|hour|hr|day|week)s?\b/i.exec(text);
  if (numeric) {
    const n = parseInt(numeric[1], 10);
    const unit = TIME_UNIT_SECONDS[numeric[2].toLowerCase()] ?? 60;
    return n * unit;
  }
  if (/\blast\s+hour\b/i.test(text)) return 3600;
  if (/\blast\s+day\b|\btoday\b/i.test(text)) return 86400;
  if (/\blast\s+week\b|\bpast\s+week\b|\bthis\s+week\b/i.test(text)) return 604800;
  return DEFAULT_WINDOW_SEC;
}

// AC-F06-2: resolves the concrete slice of the fleet the query refers to.
// Matches on both the resolved internal type key and the raw label text, so
// mismatches between lexicon labels and ASSET_TYPES label formatting never
// cause an empty resolution.
function resolveAssets(assetIds, assetTypes) {
  let matches;
  if (assetIds.length > 0) {
    matches = FLEET.filter((a) => assetIds.includes(String(a.id).toUpperCase()));
  } else if (assetTypes.length > 0) {
    const keys = new Set(assetTypes.map((t) => resolveTypeKey(t)));
    const labels = new Set(assetTypes.map((t) => t.toLowerCase()));
    matches = FLEET.filter((a) => keys.has(a.type) || labels.has(typeLabel(a.type).toLowerCase()));
  } else {
    matches = FLEET;
  }
  const seen = new Set();
  const out = [];
  for (const a of matches) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push({ id: a.id, type: typeLabel(a.type) });
  }
  return out;
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

// Pure helper used by healthScore. Blends a sigma-based z-score with a
// sigma-independent relative deviation so severe deviations are penalised
// heavily even if the reference std-band is small or unavailable.
function deviationPenalty(value, mean, sigma) {
  if (!Number.isFinite(value) || !Number.isFinite(mean)) return 0;
  const z = Number.isFinite(sigma) && sigma > 0 ? Math.abs(value - mean) / sigma : 0;
  const relDev = mean !== 0 ? Math.abs(value - mean) / Math.abs(mean) : (value === mean ? 0 : 1);
  const raw = Math.max(0, z - 1) * 25 + relDev * 40;
  return Math.min(90, raw);
}

// AC-F06-4: health = 100 at nominal, falls below 50 under severe deviation.
// Untrusted-input hardening: non-finite metric readings are rejected (never
// scored), consistent with the IoT security standard applied elsewhere (F02).
export function healthScore(assetType, metrics) {
  const typeKey = resolveTypeKey(String(assetType ?? ''));
  const nominal = ASSET_TYPES[typeKey]?.nominal ?? {};
  let totalPenalty = 0;
  for (const [metric, value] of Object.entries(metrics ?? {})) {
    if (!Number.isFinite(value)) continue; // reject non-finite untrusted input
    const band = nominal[metric];
    if (!band) continue; // unknown metric for this type: ignore, not guessed
    const [mean, sigma] = band;
    totalPenalty += deviationPenalty(value, mean, sigma);
  }
  const score = 100 - totalPenalty;
  return Math.max(0, Math.min(100, score));
}
