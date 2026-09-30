// F03 — Automated work orders.
// Read-only towards OT (IEC 62443): only consumes anomalies (F02) and calls F05 inventory API.
// No operator/technician names stored — assetId only (privacy standard).
// AC-F03-1, AC-F03-2, AC-F03-3, AC-F03-4 all covered below.

const SEVERITY_TO_PRIORITY = {
  critical: 'P1',
  high: 'P2',
  medium: 'P3',
  // low: no WO raised — AC-F03-1
};

const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3 };

const SLA_HOURS = { P1: 4, P2: 24, P3: 72 };

// Static playbook table: failureMode -> { title, tasks[], parts[] }.
// Keyed by failureMode primarily; assetType can refine tasks if needed later.
// NOTE: parts skus kept aligned with the reference inventory's known catalog
// (SEAL-M42, BRG-6205) — reserveParts() below tolerates unknown skus safely
// as a full shortfall instead of throwing, so a bad/unrecognised sku never
// blocks WO creation (spec risk: "shortfall must not block WO creation").
const PLAYBOOKS = {
  cavitation: {
    title: 'Investigate cavitation / seal wear',
    tasks: [
      'Inspect suction line for restrictions',
      'Check NPSH margin against duty point',
      'Replace mechanical seal',
    ],
    parts: [{ sku: 'SEAL-M42', qty: 1 }],
  },
  bearing_wear: {
    title: 'Bearing inspection and replacement',
    tasks: [
      'Measure vibration spectrum at bearing housing',
      'Inspect lubrication condition',
      'Replace bearing set',
    ],
    parts: [{ sku: 'BRG-6205', qty: 2 }],
  },
  misalignment: {
    title: 'Shaft alignment correction',
    tasks: [
      'Perform laser shaft alignment check',
      'Inspect coupling for wear',
      'Re-align and torque coupling bolts',
    ],
    parts: [{ sku: 'COUP-KIT-1', qty: 1 }],
  },
};

const DEFAULT_PLAYBOOK = {
  title: 'General inspection',
  tasks: ['Inspect asset for abnormal condition', 'Log findings and escalate if needed'],
  parts: [],
};

function priorityFor(severity) {
  return SEVERITY_TO_PRIORITY[severity] ?? null;
}

function playbookFor(assetType, failureMode) {
  const pb = PLAYBOOKS[failureMode] ?? DEFAULT_PLAYBOOK;
  return { title: pb.title, tasks: [...pb.tasks], parts: pb.parts.map((p) => ({ ...p })) };
}

function isValidAnomaly(anomaly) {
  if (!anomaly || typeof anomaly !== 'object') return false;
  if (typeof anomaly.assetId !== 'string' || !anomaly.assetId) return false;
  if (typeof anomaly.assetType !== 'string' || !anomaly.assetType) return false;
  if (typeof anomaly.failureMode !== 'string' || !anomaly.failureMode) return false;
  if (!(anomaly.severity in SEVERITY_TO_PRIORITY) && anomaly.severity !== 'low') return false;
  return true;
}

export function createWorkOrderService({ inventory } = {}) {
  const woStore = new Map();
  const openIndex = new Map(); // 'assetId::failureMode' -> woId (only while not closed)
  let seq = 1000;

  function nextId() {
    seq += 1;
    return `WO-${seq}`;
  }

  function reserveParts(woId, parts) {
    let anyShortfall = false;
    const out = parts.map((p) => {
      if (!inventory) {
        return { sku: p.sku, qty: p.qty, reserved: p.qty, shortfall: 0 };
      }
      // Unknown/unrecognised skus (or any inventory error) must never block
      // WO creation — treat as a full shortfall instead of throwing (AC-F03-3
      // + design risk note: "shortfall must not block WO creation").
      let res;
      try {
        res = inventory.reserve(p.sku, p.qty, woId);
      } catch {
        res = { ok: false, reserved: 0, shortfall: p.qty };
      }
      const reserved = res?.reserved ?? 0;
      const shortfall = res?.shortfall ?? Math.max(0, p.qty - reserved);
      if (shortfall > 0) anyShortfall = true;
      return { sku: p.sku, qty: p.qty, reserved, shortfall };
    });
    return { parts: out, anyShortfall };
  }

  function fromAnomaly(anomaly) {
    if (!isValidAnomaly(anomaly)) return null;
    const priority = priorityFor(anomaly.severity);
    if (!priority) return null; // low severity — AC-F03-1

    const key = `${anomaly.assetId}::${anomaly.failureMode}`;
    const existingId = openIndex.get(key);

    if (existingId) {
      const wo = woStore.get(existingId);
      wo.occurrences += 1;
      wo.anomalyIds.push(anomaly.id);
      wo.lastSeen = anomaly.ts;
      wo.deduplicated = true;
      const newRank = PRIORITY_RANK[priority];
      const curRank = PRIORITY_RANK[wo.priority];
      if (newRank < curRank) {
        wo.priority = priority;
        wo.slaHours = SLA_HOURS[priority];
        wo.history.push({ ts: anomaly.ts, event: 'priority_escalated', detail: priority });
      }
      wo.history.push({ ts: anomaly.ts, event: 'anomaly_dedup', detail: anomaly.id });
      return wo;
    }

    const id = nextId();
    const pb = playbookFor(anomaly.assetType, anomaly.failureMode);
    const { parts, anyShortfall } = reserveParts(id, pb.parts);

    const wo = {
      id,
      assetId: anomaly.assetId,
      assetType: anomaly.assetType,
      failureMode: anomaly.failureMode,
      priority,
      slaHours: SLA_HOURS[priority],
      status: anyShortfall ? 'waiting_parts' : 'open',
      title: pb.title,
      tasks: pb.tasks,
      parts,
      occurrences: 1,
      anomalyIds: [anomaly.id],
      createdAt: anomaly.ts,
      lastSeen: anomaly.ts,
      history: [{ ts: anomaly.ts, event: 'created', detail: anomaly.id }],
      deduplicated: false,
    };

    woStore.set(id, wo);
    openIndex.set(key, id);
    return wo;
  }

  function close(id) {
    const wo = woStore.get(id);
    if (!wo) return false;
    if (wo.status === 'closed') return false;
    if (inventory) {
      try {
        inventory.consume(id);
      } catch {
        // never let a downstream inventory error block closing a WO
      }
    }
    wo.status = 'closed';
    wo.history.push({ ts: wo.lastSeen, event: 'closed', detail: null });
    const key = `${wo.assetId}::${wo.failureMode}`;
    if (openIndex.get(key) === id) openIndex.delete(key);
    return true;
  }

  function list() {
    return Array.from(woStore.values());
  }

  function get(id) {
    return woStore.get(id) ?? null;
  }

  return { fromAnomaly, close, list, get };
}
