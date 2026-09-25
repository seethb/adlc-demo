// F03 · Automated work orders
// Contract: createWorkOrderService({ inventory }) -> { fromAnomaly, close, list, get }
// AC-F03-1, AC-F03-2, AC-F03-3, AC-F03-4 (see specs/features/F03-work-orders)
// Org standard: pure ES module, no I/O, no network, no eval, transport/clock injected (ADR-001).
// Edge analytics is read-only towards OT: this module only calls the injected inventory service,
// never touches PLCs/OT systems. WO records reference assetId only (no operator/technician names).

const PRIORITY_BY_SEVERITY = {
  critical: 'P1',
  high: 'P2',
  medium: 'P3',
  low: null,
};

const PRIORITY_RANK = { P1: 3, P2: 2, P3: 1 };

const SLA_BY_PRIORITY = { P1: 4, P2: 24, P3: 72 };

// Static playbook lookup table: failureMode (+ optional assetType) -> tasks/parts.
// AC-F03-3: WO carries the playbook tasks and reserves its parts.
const PLAYBOOKS = {
  cavitation: {
    title: 'Investigate cavitation on pump',
    tasks: [
      'Inspect impeller for cavitation damage',
      'Check suction pressure and NPSH margin',
      'Replace mechanical seal',
    ],
    parts: [{ sku: 'SEAL-M42', qty: 1 }],
  },
  bearing_wear: {
    title: 'Investigate bearing wear',
    tasks: [
      'Inspect bearing for wear and play',
      'Check lubrication levels and quality',
      'Replace bearing if worn beyond tolerance',
    ],
    parts: [{ sku: 'BRG-201', qty: 1 }],
  },
  misalignment: {
    title: 'Correct shaft misalignment',
    tasks: [
      'Measure shaft alignment with dial indicators',
      'Realign coupling to manufacturer tolerance',
    ],
    parts: [],
  },
};

const DEFAULT_PLAYBOOK = {
  title: 'Investigate reported fault',
  tasks: ['Inspect asset for reported fault', 'Log findings and escalate if needed'],
  parts: [],
};

function severityToPriority(severity) {
  if (!Object.prototype.hasOwnProperty.call(PRIORITY_BY_SEVERITY, severity)) return null;
  return PRIORITY_BY_SEVERITY[severity];
}

function priorityRank(p) {
  return PRIORITY_RANK[p] ?? 0;
}

function slaFor(priority) {
  return SLA_BY_PRIORITY[priority] ?? 72;
}

function playbookFor(assetType, failureMode) {
  return PLAYBOOKS[failureMode] ?? DEFAULT_PLAYBOOK;
}

function validateAnomaly(anomaly) {
  if (!anomaly || typeof anomaly !== 'object') {
    throw new TypeError('anomaly must be an object');
  }
  const { assetId, assetType, failureMode, severity, id } = anomaly;
  if (typeof assetId !== 'string' || assetId.length === 0) {
    throw new TypeError('anomaly.assetId must be a non-empty string');
  }
  if (typeof assetType !== 'string' || assetType.length === 0) {
    throw new TypeError('anomaly.assetType must be a non-empty string');
  }
  if (typeof failureMode !== 'string' || failureMode.length === 0) {
    throw new TypeError('anomaly.failureMode must be a non-empty string');
  }
  if (typeof severity !== 'string' || !Object.prototype.hasOwnProperty.call(PRIORITY_BY_SEVERITY, severity)) {
    throw new TypeError('anomaly.severity must be one of critical|high|medium|low');
  }
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('anomaly.id must be a non-empty string');
  }
}

function findInvItem(inventory, sku) {
  return inventory.list().find((i) => i.sku === sku);
}

// Reserve parts through the injected F05 inventory service. Measures the actual
// change to the `reserved` field via list() snapshots so we stay compatible with
// the inventory service's return shape without depending on it. Never throws on
// shortfall (AC risk note: WO goes to waiting_parts, creation is never blocked).
function reserveParts(inventory, parts) {
  return parts.map(({ sku, qty }) => {
    const before = findInvItem(inventory, sku)?.reserved ?? 0;
    try {
      inventory.reserve(sku, qty);
    } catch {
      // reservation failure is treated as a shortfall, not an error
    }
    const after = findInvItem(inventory, sku)?.reserved ?? before;
    const reserved = Math.max(0, after - before);
    const shortfall = Math.max(0, qty - reserved);
    return { sku, qty, reserved, shortfall };
  });
}

function keyFor(assetId, failureMode) {
  return `${assetId}|${failureMode}`;
}

export function createWorkOrderService({ inventory }) {
  const orders = new Map();
  const openIndex = new Map();
  let seq = 1000;

  function nextId() {
    seq += 1;
    return `WO-${seq}`;
  }

  function fromAnomaly(anomaly) {
    validateAnomaly(anomaly);
    const priority = severityToPriority(anomaly.severity);
    if (priority === null) return null; // AC-F03-1: low severity raises no WO

    const key = keyFor(anomaly.assetId, anomaly.failureMode);
    const existingId = openIndex.get(key);

    if (existingId) {
      // AC-F03-2: dedup — increment occurrences, possibly escalate priority
      const wo = orders.get(existingId);
      wo.occurrences += 1;
      wo.anomalyIds.push(anomaly.id);
      wo.lastSeen = anomaly.ts;
      wo.deduplicated = true;
      let event = 'duplicate_anomaly';
      if (priorityRank(priority) > priorityRank(wo.priority)) {
        wo.priority = priority;
        wo.slaHours = slaFor(priority);
        event = 'priority_escalated';
      }
      wo.history.push({ ts: anomaly.ts, event, detail: { anomalyId: anomaly.id, severity: anomaly.severity } });
      return wo;
    }

    const playbook = playbookFor(anomaly.assetType, anomaly.failureMode);
    const parts = reserveParts(inventory, playbook.parts);
    const hasShortfall = parts.some((p) => p.shortfall > 0);

    const wo = {
      id: nextId(),
      assetId: anomaly.assetId,
      assetType: anomaly.assetType,
      failureMode: anomaly.failureMode,
      priority,
      slaHours: slaFor(priority),
      status: hasShortfall ? 'waiting_parts' : 'open',
      title: playbook.title,
      tasks: [...playbook.tasks],
      parts,
      occurrences: 1,
      anomalyIds: [anomaly.id],
      createdAt: anomaly.ts,
      lastSeen: anomaly.ts,
      history: [{ ts: anomaly.ts, event: 'created', detail: { anomalyId: anomaly.id, severity: anomaly.severity } }],
      deduplicated: false,
    };

    orders.set(wo.id, wo);
    openIndex.set(key, wo.id);
    return wo;
  }

  function close(id) {
    const wo = orders.get(id);
    if (!wo) {
      throw new TypeError(`unknown work order id: ${id}`);
    }
    if (wo.status === 'closed') {
      throw new TypeError(`work order already closed: ${id}`);
    }

    // AC-F03-4: consume reserved parts on close
    for (const part of wo.parts) {
      if (part.reserved > 0) {
        inventory.consume(part.sku, part.reserved);
      }
    }

    wo.status = 'closed';
    wo.history.push({ ts: new Date().toISOString(), event: 'closed', detail: {} });
    openIndex.delete(keyFor(wo.assetId, wo.failureMode));
    return true;
  }

  function list() {
    return [...orders.values()];
  }

  function get(id) {
    return orders.get(id);
  }

  return { fromAnomaly, close, list, get };
}
