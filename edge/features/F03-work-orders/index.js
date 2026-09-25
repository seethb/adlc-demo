// F03 · Automated work orders
// SPDX-License-Identifier: proprietary
//
// Data classification: work orders produced here are C2 Confidential (asset ids,
// failure modes, maintenance state). No PII/operator identity is ever stored —
// only pseudonymous assetId. This module is a read-only edge cache; the cloud
// CMMS remains the system of record for closed-loop WO lifecycle (org security
// standard, IEC 62443 zones/conduits: edge analytics never writes to OT).
//
// Untrusted-input handling (OWASP IoT I5 / org security-standard, per AC-F02-6
// analogue applied here): anomaly events are treated as untrusted telemetry-
// derived data. fromAnomaly() rejects (returns null, silently but auditably via
// an internal rejected-count) anomalies that:
//   - are missing/malformed assetId, assetType or failureMode,
//   - carry an unknown/unmapped severity value,
//   - carry a non-finite `confidence` when present,
//   - carry a timestamp that is not a valid ISO date, or that is strictly
//     older than the last accepted anomaly timestamp for the same asset
//     (replay/out-of-order rejection).
//
// No I/O, no network, no eval, no process.env — pure ES module (ADR-001).

const SEVERITY_PRIORITY = { critical: 'P1', high: 'P2', medium: 'P3' };
const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3 }; // lower rank = more severe
const SLA_BY_PRIORITY = { P1: 4, P2: 24, P3: 72 };
const KNOWN_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

// Static playbook lookup keyed by 'assetType|failureMode'; generic fallback otherwise.
const PLAYBOOKS = new Map([
  ['centrifugal_pump|cavitation', {
    title: 'Investigate pump cavitation',
    tasks: ['Check suction pressure & NPSH margin', 'Inspect impeller for erosion', 'Verify mechanical seal condition'],
    parts: [{ sku: 'SEAL-M42', qty: 1 }],
  }],
  ['motor|bearing_wear', {
    title: 'Replace worn motor bearing',
    tasks: ['Measure vibration spectrum', 'Replace bearing set', 'Realign coupling'],
    parts: [{ sku: 'BRG-6205', qty: 2 }],
  }],
  ['shaft|misalignment', {
    title: 'Correct shaft misalignment',
    tasks: ['Laser-align coupling', 'Inspect coupling elastomer', 'Recheck vibration after alignment'],
    parts: [],
  }],
]);

function genericPlaybook(failureMode) {
  return {
    title: `Investigate ${failureMode.replace(/_/g, ' ')}`,
    tasks: ['Inspect asset', 'Review anomaly history', 'Schedule technician follow-up'],
    parts: [],
  };
}

function lookupPlaybook(assetType, failureMode) {
  const key = `${assetType}|${failureMode}`;
  const pb = PLAYBOOKS.get(key);
  return pb ? { title: pb.title, tasks: [...pb.tasks], parts: pb.parts.map(p => ({ ...p })) } : genericPlaybook(failureMode);
}

function isValidAnomaly(a) {
  if (!a || typeof a !== 'object') return false;
  if (typeof a.assetId !== 'string' || a.assetId.length === 0) return false;
  if (typeof a.assetType !== 'string' || a.assetType.length === 0) return false;
  if (typeof a.failureMode !== 'string' || a.failureMode.length === 0) return false;
  if (typeof a.severity !== 'string' || !KNOWN_SEVERITIES.has(a.severity)) return false;
  if (a.confidence !== undefined && !Number.isFinite(a.confidence)) return false;
  if (a.ts !== undefined) {
    const t = Date.parse(a.ts);
    if (Number.isNaN(t)) return false;
  }
  return true;
}

export function createWorkOrderService({ inventory }) {
  const woStore = new Map();
  const dedupIndex = new Map(); // 'assetId|failureMode' -> woId
  const lastSeenByAsset = new Map(); // assetId -> ts (ms)
  let seq = 1000;
  let rejected = 0;

  function nextId() {
    seq += 1;
    return `WO-${seq}`;
  }

  function mapPriority(severity) {
    return SEVERITY_PRIORITY[severity] ?? null;
  }

  function reserveParts(parts, woId) {
    let hasShortfall = false;
    const result = parts.map(({ sku, qty }) => {
      let reservedQty = 0;
      let shortfall = 0;
      const res = inventory.reserve(sku, qty, woId);
      if (res && typeof res === 'object') {
        reservedQty = Number.isFinite(res.reserved) ? res.reserved : qty;
        shortfall = Number.isFinite(res.shortfall) ? res.shortfall : 0;
      } else if (res === true) {
        reservedQty = qty;
      } else {
        reservedQty = qty;
      }
      if (shortfall > 0) hasShortfall = true;
      return { sku, qty, reserved: reservedQty, shortfall };
    });
    return { parts: result, hasShortfall };
  }

  function toPublic(wo) {
    return {
      ...wo,
      tasks: [...wo.tasks],
      parts: wo.parts.map(p => ({ ...p })),
      anomalyIds: [...wo.anomalyIds],
      history: [...wo.history],
    };
  }

  function fromAnomaly(anomaly) {
    if (!isValidAnomaly(anomaly)) {
      rejected += 1;
      return null;
    }

    const { assetId, assetType, failureMode, severity, id: anomalyId, ts } = anomaly;

    // Replay / out-of-order rejection per asset (OWASP IoT I5).
    if (ts !== undefined) {
      const tMs = Date.parse(ts);
      const last = lastSeenByAsset.get(assetId);
      if (last !== undefined && tMs < last) {
        rejected += 1;
        return null;
      }
      lastSeenByAsset.set(assetId, tMs);
    }

    const priority = mapPriority(severity);
    if (priority === null) return null; // low severity: no WO raised (AC-F03-1)

    const dedupKey = `${assetId}|${failureMode}`;
    const existingId = dedupIndex.get(dedupKey);

    if (existingId) {
      const wo = woStore.get(existingId);
      wo.occurrences += 1;
      if (anomalyId) wo.anomalyIds.push(anomalyId);
      wo.lastSeen = ts ?? wo.lastSeen;
      wo.history.push({ at: wo.lastSeen, event: 'occurrence', severity });
      if (PRIORITY_RANK[priority] < PRIORITY_RANK[wo.priority]) {
        wo.priority = priority;
        wo.slaHours = SLA_BY_PRIORITY[priority];
        wo.history.push({ at: wo.lastSeen, event: 'escalated', priority });
      }
      const result = toPublic(wo);
      result.deduplicated = true;
      return result;
    }

    const playbook = lookupPlaybook(assetType, failureMode);
    const id = nextId();
    const { parts, hasShortfall } = reserveParts(playbook.parts, id);

    const wo = {
      id,
      assetId,
      assetType,
      failureMode,
      priority,
      slaHours: SLA_BY_PRIORITY[priority],
      status: hasShortfall ? 'waiting_parts' : 'open',
      title: playbook.title,
      tasks: playbook.tasks,
      parts,
      occurrences: 1,
      anomalyIds: anomalyId ? [anomalyId] : [],
      createdAt: ts ?? null,
      lastSeen: ts ?? null,
      history: [{ at: ts ?? null, event: 'created', priority }],
    };

    woStore.set(id, wo);
    dedupIndex.set(dedupKey, id);

    const result = toPublic(wo);
    result.deduplicated = false;
    return result;
  }

  function close(id) {
    const wo = woStore.get(id);
    if (!wo || wo.status === 'closed') return false;
    for (const p of wo.parts) {
      if (p.reserved > 0) {
        inventory.consume(p.sku, p.reserved, wo.id);
      }
      p.reserved = 0;
    }
    wo.status = 'closed';
    wo.history.push({ at: wo.lastSeen, event: 'closed' });
    const dedupKey = `${wo.assetId}|${wo.failureMode}`;
    if (dedupIndex.get(dedupKey) === id) dedupIndex.delete(dedupKey);
    return true;
  }

  function list() {
    return [...woStore.values()].map(toPublic);
  }

  function get(id) {
    const wo = woStore.get(id);
    return wo ? toPublic(wo) : undefined;
  }

  return { fromAnomaly, close, list, get };
}
