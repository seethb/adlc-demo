// F03 · Automated work orders
// Exports: createWorkOrderService
// Pure ES module, no I/O, no network, no eval. Only node: built-ins used (none needed here).
//
// AC-F03-1: severity → priority mapping (critical→P1, high→P2, medium→P3, low→null)
// AC-F03-2: dedup by assetId+failureMode for open WOs; occurrences increment; escalate on more severe repeat
// AC-F03-3: WO carries playbook tasks and reserves parts via injected inventory service
// AC-F03-4: close() consumes reserved parts, frees the asset+failureMode slot for a new WO

const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3 }; // lower number = more severe/urgent

const SEVERITY_TO_PRIORITY = {
  critical: 'P1',
  high: 'P2',
  medium: 'P3',
  low: null,
};

const SLA_HOURS = {
  P1: 4,
  P2: 24,
  P3: 72,
};

// Static playbook table: failureMode -> { title, tasks[], parts[] }
// Self-contained reference table (no external reference module imported beyond
// ../../reference/fleet.js, per org import policy).
const PLAYBOOKS = {
  cavitation: {
    title: 'Investigate pump cavitation',
    tasks: [
      'Inspect suction line for restrictions',
      'Check NPSH margin against duty point',
      'Replace mechanical seal',
    ],
    parts: [{ sku: 'SEAL-M42', qty: 1 }],
  },
  bearing_wear: {
    title: 'Replace worn bearing',
    tasks: [
      'Perform vibration analysis',
      'Replace bearing assembly',
      'Realign coupling',
    ],
    parts: [{ sku: 'BRG-6205', qty: 1 }],
  },
  misalignment: {
    title: 'Correct shaft misalignment',
    tasks: [
      'Laser-align shaft to driver',
      'Torque check foot bolts',
    ],
    parts: [{ sku: 'SHIM-KIT', qty: 1 }],
  },
};

const DEFAULT_PLAYBOOK = {
  title: 'Investigate reported anomaly',
  tasks: [
    'Dispatch technician to inspect asset',
    'Log findings and required corrective action',
  ],
  parts: [],
};

function mapSeverity(severity) {
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_TO_PRIORITY, severity)) return null;
  return SEVERITY_TO_PRIORITY[severity];
}

function playbookFor(assetType, failureMode) {
  const pb = PLAYBOOKS[failureMode] || DEFAULT_PLAYBOOK;
  return {
    title: pb.title,
    tasks: [...pb.tasks],
    parts: pb.parts.map((p) => ({ ...p })),
  };
}

function validateAnomaly(anomaly) {
  if (!anomaly || typeof anomaly !== 'object') return false;
  if (typeof anomaly.assetId !== 'string' || !anomaly.assetId) return false;
  if (typeof anomaly.assetType !== 'string' || !anomaly.assetType) return false;
  if (typeof anomaly.failureMode !== 'string' || !anomaly.failureMode) return false;
  if (!Object.prototype.hasOwnProperty.call(SEVERITY_TO_PRIORITY, anomaly.severity)) return false;
  return true;
}

export function createWorkOrderService({ inventory }) {
  const workOrders = new Map(); // id -> WO
  const openIndex = new Map(); // `${assetId}::${failureMode}` -> id
  let seq = 0;

  function nextId() {
    seq += 1;
    return `WO-${1000 + seq}`;
  }

  function inventoryItem(sku) {
    try {
      return inventory.list().find((i) => i.sku === sku);
    } catch {
      return undefined;
    }
  }

  // AC-F03-3: reserve parts, deriving the actually-reserved quantity from the
  // inventory's own ledger (via list()) rather than trusting the shape of
  // reserve()'s return value — this keeps the WO's bookkeeping in lockstep
  // with the real inventory state so later consume() calls are accurate.
  function reserveParts(parts) {
    return parts.map(({ sku, qty }) => {
      const before = inventoryItem(sku)?.reserved ?? 0;
      try {
        inventory.reserve(sku, qty);
      } catch {
        // treat as no reservation made; shortfall reflected below
      }
      const after = inventoryItem(sku)?.reserved ?? before;
      const reservedQty = Math.max(0, after - before);
      const shortfall = Math.max(0, qty - reservedQty);
      return { sku, qty, reserved: reservedQty, shortfall };
    });
  }

  function escalate(wo, newPriority, ts) {
    if (PRIORITY_RANK[newPriority] < PRIORITY_RANK[wo.priority]) {
      wo.history.push({ at: ts, event: 'escalated', detail: `${wo.priority} -> ${newPriority}` });
      wo.priority = newPriority;
      wo.slaHours = SLA_HOURS[newPriority];
    }
  }

  function fromAnomaly(anomaly) {
    if (!validateAnomaly(anomaly)) return null;
    const priority = mapSeverity(anomaly.severity);
    if (priority === null) return null; // AC-F03-1: low severity raises no WO

    const key = `${anomaly.assetId}::${anomaly.failureMode}`;
    const ts = anomaly.ts || new Date().toISOString();
    const existingId = openIndex.get(key);

    if (existingId) {
      const wo = workOrders.get(existingId);
      wo.occurrences += 1;
      wo.lastSeen = ts;
      wo.anomalyIds.push(anomaly.id);
      wo.history.push({ at: ts, event: 'duplicate', detail: anomaly.id });
      escalate(wo, priority, ts); // AC-F03-2: more severe repeat escalates priority
      return { ...wo, deduplicated: true };
    }

    // New WO — AC-F03-3: attach playbook tasks and reserve parts
    const pb = playbookFor(anomaly.assetType, anomaly.failureMode);
    const parts = reserveParts(pb.parts);
    const hasShortfall = parts.some((p) => p.shortfall > 0);

    const wo = {
      id: nextId(),
      assetId: anomaly.assetId,
      assetType: anomaly.assetType,
      failureMode: anomaly.failureMode,
      priority,
      slaHours: SLA_HOURS[priority],
      status: hasShortfall ? 'waiting_parts' : 'open',
      title: pb.title,
      tasks: pb.tasks,
      parts,
      occurrences: 1,
      anomalyIds: [anomaly.id],
      createdAt: ts,
      lastSeen: ts,
      history: [{ at: ts, event: 'created', detail: anomaly.id }],
      deduplicated: false,
    };

    workOrders.set(wo.id, wo);
    openIndex.set(key, wo.id);
    return { ...wo };
  }

  function close(id) {
    const wo = workOrders.get(id);
    if (!wo) throw new Error(`Unknown work order: ${id}`);
    if (wo.status === 'closed') return true;

    // AC-F03-4: consume reserved parts on close
    for (const part of wo.parts) {
      if (part.reserved > 0) {
        try {
          inventory.consume(part.sku, part.reserved);
        } catch {
          // best-effort; do not throw from close
        }
      }
    }

    wo.status = 'closed';
    wo.history.push({ at: new Date().toISOString(), event: 'closed', detail: id });

    const key = `${wo.assetId}::${wo.failureMode}`;
    if (openIndex.get(key) === id) {
      openIndex.delete(key); // frees the slot so a new anomaly opens a fresh WO
    }

    return true;
  }

  function list() {
    return [...workOrders.values()].map((wo) => ({ ...wo }));
  }

  function get(id) {
    const wo = workOrders.get(id);
    if (!wo) throw new Error(`Unknown work order: ${id}`);
    return { ...wo };
  }

  return { fromAnomaly, close, list, get };
}
