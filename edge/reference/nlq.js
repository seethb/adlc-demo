// F06 — Natural-language asset condition queries (reference implementation).
// Spec: specs/features/F06-nl-asset-query.spec.md
// parseQuery turns a question into a structured plan (AC-F06-1..3); the
// plan selects the slice of live fleet state an LLM or a template answers from.
import { FLEET, ASSET_TYPES } from './fleet.js';

const TYPE_WORDS = [
  ['centrifugal_compressor', /\b(centrifugal\s+)?compressors?\b/],
  ['centrifugal_pump', /\b(centrifugal\s+)?pumps?\b|\bcentrifugal\b(?!\s+compressor)/],
  ['motor', /\bmotors?\b/],
  ['shaft', /\bshafts?\b/],
  ['gearbox', /\bgear\s?box(es)?\b/],
];

const METRIC_WORDS = [
  ['vibration', /\bvibrat\w*|\bshak\w*/],
  ['bearingTemp', /\bbearing\w*/],
  ['windingTemp', /\bwinding\w*|\bstator\b/],
  ['current', /\bcurrent\b|\bamps?\b|\bload\b/],
  ['rpm', /\brpm\b|\bspeed\b/],
  ['flow', /\bflow\b/],
  ['suctionPressure', /\bsuction\b|\bnpsh\b|\bcavitat\w*/],
  ['dischargePressure', /\bdischarge pressure\b|\bhead\b/],
  ['misalignment', /\bmisalign\w*|\balignment\b/],
  ['shaftOrbit', /\borbit\b|\brunout\b/],
  ['torque', /\btorque\b/],
  ['surgeMargin', /\bsurge\b/],
  ['oilTemp', /\boil\b/],
  ['particleCount', /\bparticle\w*|\bdebris\b/],
];

export function parseQuery(text) {
  const q = text.toLowerCase();
  const assetIds = FLEET.filter(a => q.includes(a.id.toLowerCase()) || q.includes(a.id.toLowerCase().replace('-', ' '))).map(a => a.id);
  const assetTypes = TYPE_WORDS.filter(([, re]) => re.test(q)).map(([t]) => t);
  // "centrifugal compressor" should not also match the bare centrifugal → pump rule.
  const types = assetTypes.includes('centrifugal_compressor') && !/\bpumps?\b/.test(q) ? assetTypes.filter(t => t !== 'centrifugal_pump') : assetTypes;
  const metrics = METRIC_WORDS.filter(([, re]) => re.test(q)).map(([m]) => m);

  let intent = 'condition';
  if (/\b(parts?|spares?|stock|inventory|reorder)\b/.test(q)) intent = 'inventory';
  else if (/\bwork orders?\b|\bwos?\b|\bmaintenance backlog\b/.test(q)) intent = 'work_orders';
  else if (/\bcars?\b|\bcorrective\b|\broot cause\b/.test(q)) intent = 'car';
  else if (/\banomal\w*|\balarms?\b|\balerts?\b|\bfault\w*|\brisk\b/.test(q)) intent = 'anomalies';
  else if (/\btrend\b|\bhistory\b|\blast \d+\b|\bover time\b/.test(q)) intent = 'trend';
  else if (/\bworst\b|\brank\w*\b|\bmost\b|\bhealthiest\b|\bleast\b/.test(q)) intent = 'ranking';

  const m = q.match(/last\s+(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?)\b/);
  let windowSec = 300;
  if (m) windowSec = Number(m[1]) * (m[2].startsWith('h') ? 3600 : m[2].startsWith('m') ? 60 : 1);

  const resolved = assetIds.length
    ? assetIds
    : types.length ? FLEET.filter(a => types.includes(a.type)).map(a => a.id) : FLEET.map(a => a.id);

  return { intent, assetIds, assetTypes: types, metrics, windowSec, resolvedAssets: resolved };
}

// Health 0–100 from how far each metric sits from nominal, in σ.
export function healthScore(assetType, metrics) {
  const nominal = ASSET_TYPES[assetType]?.nominal ?? {};
  let penalty = 0;
  for (const [m, [mean, sigma]] of Object.entries(nominal)) {
    if (metrics[m] === undefined) continue;
    const dev = Math.abs(metrics[m] - mean) / Math.max(sigma, Math.abs(mean) * 0.01);
    penalty += Math.max(0, dev - 2) * 2.5;
  }
  return Math.max(0, Math.round(100 - penalty));
}

// Deterministic answer used when no LLM is configured, and as the grounding
// facts handed to the LLM when one is.
export function answerFromSnapshot(plan, snapshot) {
  const pick = snapshot.assets.filter(a => plan.resolvedAssets.includes(a.id));
  const lines = [];
  if (plan.intent === 'inventory') {
    const low = snapshot.inventory.filter(i => i.low);
    lines.push(low.length ? `${low.length} part(s) at or below reorder point: ${low.map(i => `${i.sku} (${i.available} avail)`).join(', ')}.` : 'All spare parts are above their reorder points.');
    return lines.join(' ');
  }
  if (plan.intent === 'work_orders') {
    const wos = snapshot.workOrders.filter(w => w.status !== 'closed' && plan.resolvedAssets.includes(w.assetId));
    return wos.length ? `${wos.length} open work order(s): ${wos.map(w => `${w.id} ${w.priority} ${w.title}`).join('; ')}.` : 'No open work orders for those assets.';
  }
  if (plan.intent === 'car') {
    const cars = snapshot.cars.filter(c => plan.resolvedAssets.includes(c.assetId));
    return cars.length ? cars.map(c => `${c.id} (${c.trigger}) ${c.d2_problem}. Root cause: ${c.d4_rootCause}.`).join(' ') : 'No corrective action reports for those assets.';
  }
  const ranked = [...pick].sort((a, b) => a.health - b.health);
  for (const a of plan.intent === 'ranking' ? ranked.slice(0, 3) : ranked) {
    const ms = plan.metrics.length ? plan.metrics.filter(m => a.metrics[m] !== undefined) : Object.keys(a.metrics).slice(0, 3);
    const vals = ms.map(m => `${m} ${a.metrics[m]}`).join(', ');
    const an = a.openAnomaly ? ` — ${a.openAnomaly.severity} ${a.openAnomaly.failureMode.replace(/_/g, ' ')} suspected` : '';
    lines.push(`${a.id} (${a.name}) health ${a.health}/100${vals ? `: ${vals}` : ''}${an}.`);
  }
  return lines.join(' ') || 'No matching assets.';
}
