// edge/features/F03-work-orders/index.js
//
// F03 · Automated work orders
// Pure ES module, no I/O, no network, transport/inventory injected (ADR-001).
// OT posture: strictly read-only towards OT — this module only writes to its
// own in-memory WO store and reserves/consumes parts through the injected
// `inventory` (F05) service; it never touches PLC/OT systems.

const SLA_HOURS = { P1: 4, P2: 24, P3: 72 };
const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3 };

// AC-F03-1: severity → priority mapping; low (or unknown) severities raise no WO.
const SEVERITY_TO_PRIORITY = {
  critical: 'P1',
  high: 'P2',
  medium: 'P3',
};

function priorityFor(severity) {
  return SEVERITY_TO_PRIORITY[severity] ?? null;
}

// Static playbook table: tasks + required parts per failure mode.
const PLAYBOOKS = {
  cavitation: {
    tasks: [
      'Inspect impeller for cavitation damage',
      'Check suction pressure and NPSH margin',
      'Verify mechanical seal integrity',
    ],
    parts: [{ sku: 'SEAL-M42', qty: 1 }],
  },
  bearing_wear: {
    tasks: [
      'Inspect bearing for wear and lubrication condition',
      'Measure vibration spectrum for bearing defect frequencies',
      'Replace bearing if wear exceeds tolerance',
    ],
    parts: [{ sku: 'BRG-6205', qty: 1 }],
  },
  misalignment: {
    tasks: [
      'Perform laser shaft alignment check',
      'Inspect coupling for wear',
      'Re-align shaft to manufacturer spec',
    ],
    parts: [{ sku: 'COUPLING-K12', qty: 1 }],
  },
  default: {
    tasks: [
      'Inspect asset for the reported fault condition',
      'Log findings and schedule follow-up inspection',
    ],
    parts: [],
  },
};

function playbookFor(assetType, failureMode) {
  const pb = PLAYBOOKS[failureMode] ?? PLAYBOOKS.default;
  return {
    tasks: [...pb.tasks],
    parts: pb.parts.map((p) => ({ ...p })),
  };
}

function validateAnomaly(anomaly) {
  if (!anomaly || typeof anomaly !== 'object') {
    throw new TypeError('F03: anomaly must be an object');
  }
  const required = ['assetId', 'assetType', 'failureMode', 'severity'];
  for (const field of required) {
    if (anomaly[field] === undefined || anomaly[field] === null) {
      throw new TypeError(`F03: anomaly missing required field "${field}"`);
    }
  }
}

/**
 * createWorkOrderService({ inventory }) — see design doc / spec contract.
 */
export function createWorkOrderService({ inventory }) {
  if (!inventory) {
    throw new TypeError('F03: createWorkOrderService requires an `inventory` dependency');
  }

  /** @type {Map<string, object>} */
  const store = new Map();
  /** @type {Map<string, string>} */
  const openIndex = new Map(); // 'assetId::failureMode' -> woId
  let seq = 1000;

  function nextId() {
    seq += 1;
    return `WO-${seq}`;
  }

  // AC-F03-3: reserve parts through the injected inventory service.
  // Tolerant to varying inventory.reserve() return shapes (object with
  // reserved/shortfall, boolean, or void-on-success).
  function reservePart(partDef) {
    const { sku, qty } = partDef;
    let reserved = 0;
    let shortfall = qty;
    try {
      const result = inventory.reserve(sku, qty);
      if (result && typeof result === 'object') {
        if (typeof result.reserved === 'number') {
          reserved = result.reserved;
        } else if (result.ok === false) {
          reserved = 0;
        } else {
          reserved = qty;
        }
        shortfall = typeof result.shortfall === 'number'
          ? result.shortfall
          : Math.max(0, qty - reserved);
      } else if (result === false) {
        reserved = 0;
        shortfall = qty;
      } else {
        // true, undefined, or any other truthy/void result: assume success.
        reserved = qty;
        shortfall = 0;
      }
    } catch {
      reserved = 0;
      shortfall = qty;
    }
    return { sku, qty, reserved, shortfall };
  }

  function consumePart(part) {
    if (part.reserved > 0) {
      try {
        inventory.consume(part.sku, part.reserved);
      } catch {
        // best effort: inventory service is source of truth for stock levels
      }
    }
  }

  function keyOf(assetId, failureMode) {
    return `${assetId}::${failureMode}`;
  }

  // AC-F03-2: escalate priority on a more severe repeat, never downgrade.
  function escalate(wo, newPriority, ts) {
    if (PRIORITY_RANK[newPriority] < PRIORITY_RANK[wo.priority]) {
      wo.history.push({ ts, event: 'escalated', from: wo.priority, to: newPriority });
      wo.priority = newPriority;
      wo.slaHours = SLA_HOURS[newPriority];
      return true;
    }
    return false;
  }

  function fromAnomaly(anomaly) {
    validateAnomaly(anomaly);

    // AC-F03-1: low (or otherwise unmapped) severity raises no WO.
    const priority = priorityFor(anomaly.severity);
    if (!priority) return null;

    const now = anomaly.ts ?? new Date().toISOString();
    const key = keyOf(anomaly.assetId, anomaly.failureMode);
    const existingId = openIndex.get(key);

    // AC-F03-2: at most one open WO per asset + failure mode.
    if (existingId) {
      const wo = store.get(existingId);
      wo.occurrences += 1;
      wo.anomalyIds.push(anomaly.id);
      wo.lastSeen = now;
      wo.history.push({ ts: now, event: 'duplicate_anomaly', anomalyId: anomaly.id });
      escalate(wo, priority, now);
      wo.deduplicated = true;
      return wo;
    }

    // AC-F03-3: new WO carries playbook tasks and reserves its parts.
    const { tasks, parts: partDefs } = playbookFor(anomaly.assetType, anomaly.failureMode);
    const parts = partDefs.map(reservePart);
    const waitingParts = parts.some((p) => p.shortfall > 0);

    const id = nextId();
    const wo = {
      id,
      assetId: anomaly.assetId,
      assetType: anomaly.assetType,
      failureMode: anomaly.failureMode,
      priority,
      slaHours: SLA_HOURS[priority],
      status: waitingParts ? 'waiting_parts' : 'open',
      title: `${anomaly.failureMode.replace(/_/g, ' ')} on ${anomaly.assetId}`,
      tasks,
      parts,
      occurrences: 1,
      anomalyIds: [anomaly.id],
      createdAt: now,
      lastSeen: now,
      history: [{ ts: now, event: 'created', priority }],
      deduplicated: false,
    };

    store.set(id, wo);
    openIndex.set(key, id);
    return wo;
  }

  // AC-F03-4: closing a WO consumes its reserved parts and frees the
  // asset+failure-mode slot so a new WO may open.
  function close(id) {
    const wo = store.get(id);
    if (!wo) return false;
    if (wo.status === 'closed') return true;

    for (const part of wo.parts) {
      consumePart(part);
      part.reserved = 0;
      part.shortfall = 0;
    }

    wo.status = 'closed';
    wo.history.push({ ts: new Date().toISOString(), event: 'closed' });

    const key = keyOf(wo.assetId, wo.failureMode);
    if (openIndex.get(key) === id) {
      openIndex.delete(key);
    }
    return true;
  }

  function list() {
    return Array.from(store.values());
  }

  function get(id) {
    return store.get(id);
  }

  return { fromAnomaly, close, list, get };
}
