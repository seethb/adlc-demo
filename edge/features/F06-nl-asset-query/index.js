// F06 · Natural-language asset queries (NLQ)
// Pure ES module — no I/O, no network, no eval, no process.env (org standard ADR-001).
// Only allowed import: node: built-ins or '../../reference/fleet.js'.
// IoT security standard: all free-text and metric input here is treated as
// untrusted (OWASP IoT I5) — non-finite values / unknown ids are rejected below.
import { FLEET } from '../../reference/fleet.js';

// ---------------------------------------------------------------------------
// Static lookup tables (module-scope, no per-call mutable state).
// ---------------------------------------------------------------------------

// AC-F06-1: ordered, deterministic intent patterns — first match wins, no ML,
// so the golden-set accuracy is fully reproducible.
const INTENT_PATTERNS = [
  { intent: 'car', re: /\bcars?\b|corrective action report/i },
  { intent: 'work_orders', re: /work orders?|maintenance ticket/i },
  { intent: 'inventory', re: /spare parts?|inventory|stock level|in stock/i },
  { intent: 'ranking', re: /\btop\b|\bworst\b|\bbest\b|\brank(ed|ing)?\b|which .*(most|least)/i },
  { intent: 'anomalies', re: /anomal|unusual|outlier|deviat|\brisk\b|cavitation/i },
  {
    intent: 'trend',
    re: /trend|over time|history|(last|past)\s+\d+\s*(second|seconds|minute|minutes|hour|hours)/i,
  },
  { intent: 'condition', re: /how is|status|condition|performing|\bhealth\b/i },
];

// AC-F06-2: known asset-id prefixes derived from the fleet reference — grounds
// id extraction in real fleet data instead of guessing arbitrary letter+digit
// tokens out of free text (avoids matching "last 10" as an asset id).
const KNOWN_PREFIXES = new Set(FLEET.map((a) => a.id.split(/[-\s]/)[0].toUpperCase()));

// AC-F06-2: canonical asset types + disambiguation of bare "centrifugal".
const ASSET_TYPE_RULES = [
  { type: 'centrifugal pump', re: /centrifugal\s+pumps?\b/i },
  { type: 'centrifugal compressor', re: /centrifugal\s+compressors?\b/i },
  { type: 'motor', re: /\bmotors?\b/i },
  { type: 'shaft', re: /\bshafts?\b/i },
  { type: 'gearbox', re: /\bgearboxe?s?\b/i },
];
// bare "pump"/"compressor" (without "centrifugal") map unambiguously since
// those are the only pump/compressor asset types in this fleet.
const BARE_TYPE_RULES = [
  { type: 'centrifugal pump', re: /\bpumps?\b/i },
  { type: 'centrifugal compressor', re: /\bcompressors?\b/i },
];

// AC-F06-3: metric aliases, most specific phrases checked first.
const METRIC_ALIASES = [
  [/suction pressure/i, 'suctionPressure'],
  [/discharge pressure/i, 'dischargePressure'],
  [/cavitation/i, 'suctionPressure'], // cavitation risk is driven by suction pressure
  [/bearing temp(erature)?/i, 'bearingTemp'],
  [/winding temp(erature)?/i, 'windingTemp'],
  [/power factor/i, 'powerFactor'],
  [/flow rate|\bflow\b/i, 'flowRate'],
  [/vibration/i, 'vibration'],
  [/\bcurrent\b/i, 'current'],
  [/\brpm\b|\bspeed\b/i, 'rpm'],
  [/\btorque\b/i, 'torque'],
  [/\befficiency\b/i, 'efficiency'],
  [/\btemperature\b/i, 'temperature'],
  [/\bpressure\b/i, 'pressure'],
];

// AC-F06-3: time window units ("last 10 minutes" -> 600).
const TIME_UNIT_SEC = {
  second: 1,
  seconds: 1,
  minute: 60,
  minutes: 60,
  hour: 3600,
  hours: 3600,
};

// AC-F06-4: internal nominal ranges per asset type (mean, sigma) used only by
// healthScore — independent, self-contained tables (not fleet.js ASSET_TYPES).
const NOMINAL_RANGES = {
  motor: {
    vibration: [1.8, 0.5],
    bearingTemp: [58, 6],
    windingTemp: [82, 8],
    current: [118, 12],
    rpm: [1485, 50],
    powerFactor: [0.87, 0.05],
  },
  'centrifugal pump': {
    vibration: [2.0, 0.5],
    bearingTemp: [55, 6],
    suctionPressure: [2.5, 0.4],
    dischargePressure: [8.0, 1.0],
    flowRate: [150, 20],
  },
  shaft: {
    vibration: [1.5, 0.4],
    torque: [220, 25],
    rpm: [1485, 50],
  },
  'centrifugal compressor': {
    vibration: [2.2, 0.5],
    bearingTemp: [60, 6],
    dischargePressure: [12, 1.5],
    efficiency: [0.82, 0.05],
  },
  gearbox: {
    vibration: [1.9, 0.5],
    bearingTemp: [62, 6],
    torque: [300, 30],
    efficiency: [0.95, 0.03],
  },
};

// ---------------------------------------------------------------------------
// Internal helpers (not exported).
// ---------------------------------------------------------------------------

function classifyIntent(text) {
  for (const { intent, re } of INTENT_PATTERNS) {
    if (re.test(text)) return intent;
  }
  return 'condition';
}

// AC-F06-2: normalizes free-text ids ("SHF 301" -> "SHF-301").
function extractAssetIds(text) {
  const re = /\b([A-Za-z]{2,6})[\s-]?(\d{2,5})\b/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const prefix = m[1].toUpperCase();
    if (!KNOWN_PREFIXES.has(prefix)) continue; // reject unknown/false-positive ids
    const id = `${prefix}-${m[2]}`;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

// AC-F06-2: resolves canonical asset types; bare "centrifugal" -> ambiguous.
function extractAssetTypes(text) {
  const types = [];
  for (const { type, re } of ASSET_TYPE_RULES) {
    if (re.test(text) && !types.includes(type)) types.push(type);
  }
  for (const { type, re } of BARE_TYPE_RULES) {
    if (re.test(text) && !types.includes(type)) types.push(type);
  }

  let ambiguous = false;
  let candidates = [];
  if (
    /\bcentrifugal\b/i.test(text) &&
    !types.includes('centrifugal pump') &&
    !types.includes('centrifugal compressor')
  ) {
    ambiguous = true;
    candidates = ['centrifugal pump', 'centrifugal compressor'];
  }
  return { types, ambiguous, candidates };
}

function extractMetrics(text) {
  const found = [];
  for (const [re, key] of METRIC_ALIASES) {
    if (re.test(text) && !found.includes(key)) found.push(key);
  }
  return found;
}

// AC-F06-3: "last 10 minutes" -> 600.
function extractWindow(text) {
  const m = text.match(/(?:last|past)\s+(\d+)\s*(second|seconds|minute|minutes|hour|hours)/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  return n * TIME_UNIT_SEC[unit];
}

// Resolves the slice of live fleet state a query should be answered from.
// Always returns a non-empty array (AC-F06-2): explicit ids first, then
// fleet members of the resolved (or ambiguous-candidate) types, falling
// back to the whole fleet for fully generic queries. Ambiguity metadata is
// attached to the array (arrays are objects, extra props are harmless).
function resolveAssets(ids, types, ambiguous, candidates) {
  const result = new Set();
  for (const id of ids) {
    const found = FLEET.find((a) => a.id.toUpperCase() === id.toUpperCase());
    result.add(found ? found.id : id);
  }
  const targetTypes = types.length ? types : ambiguous ? candidates : [];
  for (const t of targetTypes) {
    for (const a of FLEET) if (a.type === t) result.add(a.id);
  }
  if (result.size === 0) {
    for (const a of FLEET) result.add(a.id);
  }
  const arr = Array.from(result);
  arr.ambiguous = ambiguous;
  arr.candidates = candidates;
  return arr;
}

// ---------------------------------------------------------------------------
// Exported contract.
// ---------------------------------------------------------------------------

// AC-F06-1, AC-F06-2, AC-F06-3: parses free-text NL asset queries.
export function parseQuery(text) {
  // IoT security standard: treat all external/free-text input as untrusted.
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

// AC-F06-4: health score 100 at nominal, drops below 50 with severe deviation.
// Uses RMS of per-metric z-scores vs internal NOMINAL_RANGES so a couple of
// badly-deviated metrics dominate the score even when averaged with several
// nominal ones.
export function healthScore(assetType, metrics) {
  const spec = NOMINAL_RANGES[assetType];
  if (!spec) {
    throw new TypeError(`healthScore: unknown assetType "${assetType}"`);
  }
  if (metrics === null || typeof metrics !== 'object') {
    throw new TypeError('healthScore: metrics must be an object');
  }

  const zScores = [];
  for (const [key, value] of Object.entries(metrics)) {
    // IoT security standard: reject non-finite / non-numeric metric values —
    // telemetry is untrusted input, never silently coerced (OWASP IoT I5).
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`healthScore: metric "${key}" is not a finite number`);
    }
    const nominal = spec[key];
    if (!nominal) continue; // unknown/irrelevant metric for this asset type: ignored
    const [mean, sigma] = nominal;
    const z = sigma > 0 ? Math.abs(value - mean) / sigma : 0;
    zScores.push(z);
  }

  if (zScores.length === 0) return 100; // no comparable metrics -> assume nominal

  const meanSquare = zScores.reduce((s, z) => s + z * z, 0) / zScores.length;
  const rms = Math.sqrt(meanSquare);
  const raw = 100 - rms * 20;
  return Math.round(Math.min(100, Math.max(0, raw)));
}
