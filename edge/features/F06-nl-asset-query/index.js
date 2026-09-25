// F06 · Natural-language asset queries (NLQ)
// Deterministic, dependency-free query planner + health scorer.
// Org standards: pure ES module, no I/O/network/env, only node: built-ins or
// '../../reference/fleet.js' imported (ADR-001). Read-only toward OT/fleet state.
//
// Security note (IoT security standard / OWASP IoT I5): telemetry passed into
// healthScore() is treated as untrusted input — non-finite (NaN/Infinity) or
// non-numeric values are rejected and never allowed to influence the score or
// baseline (mirrors AC-F02-6 handling used elsewhere in this codebase).

import { FLEET, ASSET_TYPES } from '../../reference/fleet.js';

// ---------------------------------------------------------------------------
// Intent patterns (AC-F06-1) — ordered, most specific first.
// ---------------------------------------------------------------------------
const INTENT_PATTERNS = [
  { intent: 'car', regexes: [/\bcars?\b/i, /corrective action report/i, /\bcapa\b/i] },
  { intent: 'work_orders', regexes: [/work\s*orders?/i, /\bwo#?\d*\b/i, /maintenance (ticket|request|job)/i] },
  { intent: 'inventory', regexes: [/spare parts?/i, /\bstock\b/i, /\binventory\b/i, /\bspares?\b/i, /on[- ]hand/i] },
  { intent: 'ranking', regexes: [/\btop\s+\d*/i, /\bworst\b/i, /\bbest\b/i, /\brank(ing)?\b/i, /highest/i, /lowest/i, /which .* (most|least)/i] },
  { intent: 'anomalies', regexes: [/anomal(y|ies)/i, /\brisk\b/i, /\bfault(s)?\b/i, /\balert(s)?\b/i, /deviat(e|ion|ing)/i, /cavitation/i, /unusual/i, /outlier/i] },
  // Trend queries: explicit trend words, OR "performance"/"history" combined with a time window
  // (e.g. "Show shaft performance for the last 10 minutes" — AC-F06-1).
  { intent: 'trend', regexes: [
      /\btrend(ing)?\b/i,
      /over time/i,
      /\bhistory\b/i,
      /historical/i,
      /tracking (over|across)/i,
      /\bperformance\b.*\b(last|past)\s+\d+\s*(second|minute|hour|day)s?\b/i,
    ] },
  { intent: 'condition', regexes: [/how is/i, /how('s| is)? .* (doing|performing)/i, /\bstatus\b/i, /\bcondition\b/i, /\bperforming\b/i, /\bhealth\b/i] },
];

function classifyIntent(text) {
  for (const { intent, regexes } of INTENT_PATTERNS) {
    if (regexes.some((re) => re.test(text))) return intent;
  }
  return 'condition'; // fail-safe default: an asset question with no other cue is a condition query
}

// ---------------------------------------------------------------------------
// Asset type resolution (AC-F06-2), with "centrifugal" disambiguation.
// ---------------------------------------------------------------------------
const TYPE_MATCH_RE =
  /\b(centrifugal\s+pumps?|centrifugal\s+compressors?|pumps?|compressors?|motors?|shafts?|gearbox(?:es)?)\b/gi;

function normalizeTypeMatch(raw) {
  const s = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (s.startsWith('centrifugal pump')) return 'centrifugal_pump';
  if (s.startsWith('centrifugal compressor')) return 'centrifugal_compressor';
  if (s.startsWith('pump')) return 'centrifugal_pump';
  if (s.startsWith('compressor')) return 'centrifugal_compressor';
  if (s.startsWith('motor')) return 'motor';
  if (s.startsWith('shaft')) return 'shaft';
  if (s.startsWith('gearbox')) return 'gearbox';
  return null; // fail-closed: no guess when ambiguous/unrecognised
}

function extractAssetTypes(text) {
  const found = [];
  for (const m of text.matchAll(TYPE_MATCH_RE)) {
    const type = normalizeTypeMatch(m[0]);
    if (type && !found.includes(type)) found.push(type);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Asset id resolution (AC-F06-2) — e.g. "SHF 301" -> "SHF-301", validated
// against the known fleet (fail-closed: unknown-looking ids are dropped).
// ---------------------------------------------------------------------------
const ID_MATCH_RE = /\b([A-Za-z]{2,4})[\s-]?(\d{3})\b/g;
const FLEET_ID_INDEX = new Map(FLEET.map((a) => [a.id.toUpperCase(), a.id]));

function extractAssetIds(text) {
  const found = [];
  for (const m of text.matchAll(ID_MATCH_RE)) {
    const candidate = `${m[1].toUpperCase()}-${m[2]}`;
    const real = FLEET_ID_INDEX.get(candidate);
    if (real && !found.includes(real)) found.push(real);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Metrics + time window extraction (AC-F06-3).
// ---------------------------------------------------------------------------
const ALL_NOMINAL_METRICS = new Set();
for (const spec of Object.values(ASSET_TYPES)) {
  for (const k of Object.keys(spec.nominal || {})) ALL_NOMINAL_METRICS.add(k);
}

function camelToPhrase(k) {
  return k.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
}

const MANUAL_METRIC_ALIASES = {
  vibration: 'vibration',
  'bearing temp': 'bearingTemp',
  'bearing temperature': 'bearingTemp',
  'winding temp': 'windingTemp',
  'winding temperature': 'windingTemp',
  current: 'current',
  amperage: 'current',
  amps: 'current',
  rpm: 'rpm',
  speed: 'rpm',
  'power factor': 'powerFactor',
  pressure: 'pressure',
  'suction pressure': 'suctionPressure',
  flow: 'flow',
  'flow rate': 'flow',
  temperature: 'temperature',
  torque: 'torque',
  efficiency: 'efficiency',
  cavitation: 'cavitation',
  noise: 'noise',
  'oil level': 'oilLevel',
  alignment: 'alignment',
};

const METRIC_ALIASES = {};
for (const metric of ALL_NOMINAL_METRICS) {
  METRIC_ALIASES[metric.toLowerCase()] = metric;
  METRIC_ALIASES[camelToPhrase(metric)] = metric;
}
for (const [alias, metric] of Object.entries(MANUAL_METRIC_ALIASES)) {
  if (ALL_NOMINAL_METRICS.has(metric)) METRIC_ALIASES[alias] = metric;
}
// sort longest-alias-first so multi-word aliases win over shorter substrings
const METRIC_ALIAS_ENTRIES = Object.entries(METRIC_ALIASES).sort((a, b) => b[0].length - a[0].length);

// Domain-knowledge hints: certain phenomena imply specific metrics that a
// purely lexical alias table would miss (e.g. cavitation risk in centrifugal
// pumps is diagnosed primarily via suction pressure) — AC-F06-3.
const KEYWORD_METRIC_HINTS = [
  { re: /\bcavitation\b/i, metrics: ['suctionPressure'] },
];

function extractMetrics(lowerText) {
  const found = [];
  for (const [alias, metric] of METRIC_ALIAS_ENTRIES) {
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lowerText) && !found.includes(metric)) found.push(metric);
  }
  for (const { re, metrics } of KEYWORD_METRIC_HINTS) {
    if (re.test(lowerText)) {
      for (const m of metrics) {
        if (ALL_NOMINAL_METRICS.has(m) && !found.includes(m)) found.push(m);
      }
    }
  }
  return found;
}

const WINDOW_UNIT_SECONDS = { second: 1, minute: 60, hour: 3600, day: 86400 };
const WINDOW_RE = /\b(?:last|past)\s+(\d+)\s*(second|minute|hour|day)s?\b/i;

function extractWindowSec(text) {
  const m = WINDOW_RE.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return n * WINDOW_UNIT_SECONDS[unit];
}

// ---------------------------------------------------------------------------
// Resolved assets — read-only lookup against the fleet registry.
// ---------------------------------------------------------------------------
function resolveAssets(assetIds, assetTypes) {
  const byId = new Map();
  for (const id of assetIds) {
    const a = FLEET.find((x) => x.id === id);
    if (a) byId.set(a.id, { id: a.id, type: a.type });
  }
  for (const type of assetTypes) {
    for (const a of FLEET) {
      if (a.type === type) byId.set(a.id, { id: a.id, type: a.type });
    }
  }
  if (byId.size === 0) {
    // fallback: fleet-wide scope so a valid query always resolves to something
    for (const a of FLEET) byId.set(a.id, { id: a.id, type: a.type });
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// Exported: parseQuery (AC-F06-1..3)
// ---------------------------------------------------------------------------
export function parseQuery(text) {
  const q = typeof text === 'string' ? text.trim() : '';
  const lower = q.toLowerCase();

  const intent = q ? classifyIntent(q) : null;
  const assetIds = q ? extractAssetIds(q) : [];
  const assetTypes = q ? extractAssetTypes(lower) : [];
  const metrics = q ? extractMetrics(lower) : [];
  const windowSec = q ? extractWindowSec(lower) : null;
  const resolvedAssets = q ? resolveAssets(assetIds, assetTypes) : [];

  return { intent, assetIds, assetTypes, metrics, windowSec, resolvedAssets };
}

// ---------------------------------------------------------------------------
// Exported: healthScore (AC-F06-4)
// ---------------------------------------------------------------------------
export function healthScore(assetType, metrics) {
  const spec = ASSET_TYPES[assetType];
  if (!spec || !spec.nominal || !metrics || typeof metrics !== 'object') return 100;

  let maxZ = 0;
  for (const [key, nominal] of Object.entries(spec.nominal)) {
    const value = metrics[key];
    // Untrusted-input handling: skip missing/non-finite readings (never score them).
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const [mean, sigma] = nominal;
    const z = sigma > 0 ? Math.abs(value - mean) / sigma : 0;
    if (z > maxZ) maxZ = z;
  }

  if (maxZ <= 1) return 100; // within one sigma of nominal for every metric
  const score = 100 - (maxZ - 1) * 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}
