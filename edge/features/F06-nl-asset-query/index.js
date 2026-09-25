// F06 · Natural-language asset queries (NLQ)
// Pure ES module — no I/O, no network, no eval (org standard ADR-001).
// Reads only static reference fleet definitions; never writes to OT (IEC 62443 read-only edge analytics).
import { FLEET, ASSET_TYPES } from '../../reference/fleet.js';

// ---------------------------------------------------------------------------
// Lexicons & constants
// ---------------------------------------------------------------------------

const MAX_TEXT_LEN = 2000; // guard against ReDoS / oversized input (security design)

const KNOWN_TYPES = Object.keys(ASSET_TYPES).length
  ? Object.keys(ASSET_TYPES)
  : ['motor', 'centrifugal pump', 'shaft', 'centrifugal compressor', 'gearbox'];

const TIME_UNIT_SEC = {
  second: 1, seconds: 1, sec: 1, secs: 1,
  minute: 60, minutes: 60, min: 60, mins: 60,
  hour: 3600, hours: 3600, hr: 3600, hrs: 3600,
  day: 86400, days: 86400,
};

// Ordered intent patterns — most specific first (AC-F06-1).
const INTENT_PATTERNS = [
  { intent: 'work_orders', re: /\bwork\s*orders?\b|\bmaintenance\s*ticket|\bwo\b/i },
  { intent: 'car', re: /\bcars?\b|\bcorrective\s+action\b/i },
  { intent: 'inventory', re: /\bspare\s*parts?\b|\binventor(y|ies)\b|\bstock\b|\bsku\b|\bon\s+hand\b|\breorder\b/i },
  { intent: 'anomalies', re: /\banomal(y|ies)\b|\bunusual\b|\bfault(s)?\b|\brisk\b|\bdeviation\b|\balert(s)?\b|\bcavitation\b/i },
  { intent: 'ranking', re: /\bwhich\b.*\b(top|worst|best|highest|lowest)\b|\brank(ing)?\b|\bcompare\b|\btop\s+\d+|\bworst\s+\d+/i },
  { intent: 'trend', re: /\btrend\b|\bover\s+time\b|\bhistory\b|\blast\s+\d+\s*(minute|minutes|hour|hours|day|days|min|mins|hr|hrs)\b|\bpast\s+\d+/i },
  { intent: 'condition', re: /\bhow\s+is\b|\bcondition\b|\bstatus\b|\bperforming\b|\bhealth\b/i },
];

// ---------------------------------------------------------------------------
// Metric lexicon — built dynamically from fleet reference nominal ranges,
// plus common synonyms (AC-F06-3).
// ---------------------------------------------------------------------------

function buildMetricLexicon() {
  const lex = {};
  for (const def of Object.values(ASSET_TYPES)) {
    const nominal = def && def.nominal ? def.nominal : {};
    for (const metric of Object.keys(nominal)) {
      const words = metric.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
      lex[words] = metric;
      lex[metric.toLowerCase()] = metric;
    }
  }
  // extra synonyms
  lex['speed'] = lex['speed'] || 'rpm';
  lex['amperage'] = lex['amperage'] || 'current';
  lex['amps'] = lex['amps'] || 'current';
  lex['temperature'] = lex['temperature'] || 'bearingTemp';
  lex['vib'] = lex['vib'] || 'vibration';
  // domain-fault synonyms: cavitation risk is diagnosed via suction pressure deviation
  // (only wire this if the fleet's pump nominal ranges actually expose suctionPressure)
  if (Object.values(ASSET_TYPES).some((d) => d && d.nominal && 'suctionPressure' in d.nominal)) {
    lex['cavitation'] = 'suctionPressure';
    lex['cavitation risk'] = 'suctionPressure';
  }
  return lex;
}

const METRIC_LEXICON = buildMetricLexicon();

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

function normalizeText(text) {
  if (typeof text !== 'string' || text.length === 0) return '';
  return text.slice(0, MAX_TEXT_LEN);
}

function extractIntent(text) {
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(text)) return intent;
  }
  return 'condition';
}

function extractAssetIds(rawText) {
  const ids = [];
  const re = /\b([A-Za-z]{2,6})[\s-](\d{2,5})\b/g;
  let m;
  while ((m = re.exec(rawText)) !== null) {
    const id = `${m[1].toUpperCase()}-${m[2]}`;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function extractAssetTypes(lowerText) {
  const types = [];
  const add = (t) => { if (!types.includes(t) && KNOWN_TYPES.includes(t)) types.push(t); };

  const hasCentrifugal = /\bcentrifugal\b/.test(lowerText);
  const hasPump = /\bpumps?\b/.test(lowerText);
  const hasCompressor = /\bcompressors?\b/.test(lowerText);

  if (hasCentrifugal || hasPump || hasCompressor) {
    if (hasPump && !hasCompressor) add('centrifugal pump');
    else if (hasCompressor && !hasPump) add('centrifugal compressor');
    else if (hasCentrifugal && hasPump === hasCompressor) {
      // ambiguous "centrifugal" alone, or both mentioned — include both (design doc)
      add('centrifugal pump');
      add('centrifugal compressor');
    }
  }

  if (/\bmotors?\b/.test(lowerText)) add('motor');
  if (/\bshafts?\b/.test(lowerText)) add('shaft');
  if (/\bgearbox(es)?\b/.test(lowerText)) add('gearbox');

  return types;
}

function extractMetrics(lowerText) {
  const found = [];
  const phrases = Object.keys(METRIC_LEXICON).sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lowerText)) {
      const canonical = METRIC_LEXICON[phrase];
      if (!found.includes(canonical)) found.push(canonical);
    }
  }
  return found;
}

function extractWindow(lowerText) {
  const re = /\b(?:last|past)\s+(\d+)\s*(second|seconds|sec|secs|minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\b/i;
  const m = re.exec(lowerText);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const mult = TIME_UNIT_SEC[unit];
  if (!mult || !Number.isFinite(n)) return null;
  return n * mult;
}

function resolveAssets(assetIds, assetTypes) {
  let matched = FLEET.filter(
    (a) => assetIds.includes(String(a.id).toUpperCase()) || assetTypes.includes(a.type)
  );
  if (matched.length === 0) matched = FLEET; // ensure resolvedAssets is never empty (AC-F06-2)
  return matched.map((a) => ({ assetId: a.id, assetType: a.type }));
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Parse a natural-language asset query.
 * AC-F06-1: deterministic intent classification.
 * AC-F06-2: resolves asset ids (incl. "SHF 301") and asset types.
 * AC-F06-3: extracts metrics and time windows.
 */
export function parseQuery(text) {
  const safeText = normalizeText(text);
  const lower = safeText.toLowerCase();

  const intent = extractIntent(safeText);
  const assetIds = extractAssetIds(safeText);
  const assetTypes = extractAssetTypes(lower);
  const metrics = extractMetrics(lower);
  const windowSec = extractWindow(lower);
  const resolvedAssets = resolveAssets(assetIds, assetTypes);

  return { intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets };
}

/**
 * Compute a 0–100 health score for an asset type given a metrics snapshot.
 * AC-F06-4: 100 at nominal, falls below 50 with severe deviation.
 * Untrusted-telemetry hardening: non-finite metric values are ignored,
 * never allowed to corrupt the score (IoT security standard, OWASP IoT I5).
 */
export function healthScore(assetType, metrics) {
  const def = ASSET_TYPES[assetType];
  const nominal = def && def.nominal ? def.nominal : {};
  let penalty = 0;

  if (metrics && typeof metrics === 'object') {
    for (const [key, val] of Object.entries(metrics)) {
      if (!Number.isFinite(val)) continue; // reject NaN/Infinity/non-numeric (untrusted input)
      const range = nominal[key];
      if (!range) continue;
      const [mean, sigma] = range;
      if (!Number.isFinite(sigma) || sigma <= 0) continue;
      const z = Math.abs(val - mean) / sigma;
      const excess = Math.max(0, z - 1);
      penalty += Math.min(50, excess * 15);
    }
  }

  const score = Math.max(0, Math.min(100, 100 - penalty));
  return Math.round(score);
}
