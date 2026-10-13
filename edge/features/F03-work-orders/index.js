// F03 — Automated work orders.
// Pure ES module: no I/O, no network, no process.env, no eval.
// Depends only on an injected F05-shaped `inventory` instance (see contract below).
//
// AC-F03-1 severity -> priority mapping (critical->P1, high->P2, medium->P3, low->null -> no WO)
// AC-F03-2 dedup per assetId+failureMode (open WOs only); repeats bump occurrences & may escalate
// AC-F03-3 playbook tasks + parts reservation via inventory.reserve(sku, qty, woId)
// AC-F03-4 close() consumes reserved parts via inventory.consume(woId); frees dedup slot

const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3 };

const SEVERITY_TO_PRIORITY = {
  critical: 'P1',
  high: 'P2',
  medium: 'P3',
  low: null,
};

const SLA_HOURS = { P1: 4, P2: 24, P3: 72 };

// Static playbook table keyed by failureMode (AC-F03-3).
const PLAYBOOKS = {
  cavitation: {
    title: 'Investigate pump cavitation',
    tasks: [
      'Inspect impeller for cavitation pitting/damage',
      'Verify suction pressure and NPSH margin',
      'Replace mechanical seal if scored or leaking',
    ],
    parts: [{ sku: 'SEAL-M42', qty: 1 }],
  },
  bearing_wear: {
    title: 'Investigate bearing wear',
    tasks: [
      'Measure vibration spectrum at bearing housings',
      'Inspect lubrication condition and grease levels',
      'Replace bearing if wear exceeds tolerance',
    ],
    parts: [{ sku: 'BRG-6205', qty: 2 }],
  },
  misalignment: {
    title: 'Investigate shaft misalignment',
    tasks: [
      'Perform laser shaft alignment check',
      'Inspect coupling for wear or play',
      'Shim/adjust base as required',
    ],
    parts: [{ sku: 'SHIM-KIT', qty: 1 }],
  },
};

const DEFAULT_PLAYBOOK = {
  title: 'Investigate anomaly',
  tasks: ['Inspect asset for abnormal condition', 'Review trend data and confirm root cause'],
  parts: [],
};

function priorityFor(severity) {
  return Object.prototype.hasOwnProperty.call(SEVERITY_TO_PRIORITY, severity)
    ? SEVERITY_TO_PRIORITY[severity]
    : null;
}

function slaFor(priority) {
  return SLA_HOURS[priority] ?? SLA_HOURS.P3;
}

function playbookFor(assetType, failureMode) {
  return PLAYBOOKS[failureMode] ?? DEFAULT_PLAYBOOK;
}

function reserveParts(woId, parts, inventory) {
  return parts.map(({ sku, qty }) => {
    if (!inventory) {
      return { sku, qty, reserved: qty, shortfall: 0 };
    }
    const res = inventory.reserve(sku, qty, woId);
    return {
      sku,
      qty,
      reserved: res?.reserved ?? 0,
      shortfall: res?.shortfall ?? qty,
    };
  });
}

function statusFor(parts) {
  return parts.some((p) => p.shortfall > 0) ? 'waiting_parts' : 'open';
}

function validateAnomaly(anomaly) {
  if (
    !anomaly ||
    typeof anomaly.id !== 'string' ||
    typeof anomaly.assetId !== 'string' ||
    typeof anomaly.assetType !== 'string' ||
    typeof anomaly.failureMode !== 'string' ||
    typeof anomaly.severity !== 'string'
  ) {
    throw new Error('F03: invalid anomaly — missing required fields');
  }
}

export function createWorkOrderService({ inventory } = {}) {
  const wosById = new Map();
  const openIndex = new Map(); // `${assetId}::${failureMode}` -> woId
  let seq = 1000;

  function nextId() {
    seq += 1;
    return `WO-${seq}`;
  }

  function fromAnomaly(anomaly) {
    validateAnomaly(anomaly);
    const priority = priorityFor(anomaly.severity);
    if (!priority) return null; // AC-F03-1: low severity raises no WO

    const key = `${anomaly.assetId}::${anomaly.failureMode}`;
    const existingId = openIndex.get(key);

    if (existingId) {
      const wo = wosById.get(existingId);
      wo.occurrences += 1;
      wo.anomalyIds.push(anomaly.id);
      wo.lastSeen = anomaly.ts;
      wo.deduplicated = true;

      if (PRIORITY_RANK[priority] < PRIORITY_RANK[wo.priority]) {
        // AC-F03-2: a more severe repeat escalates priority
        wo.history.push({
          ts: anomaly.ts,
          event: 'escalated',
          detail: { from: wo.priority, to: priority },
        });
        wo.priority = priority;
        wo.slaHours = slaFor(priority);
      }
      wo.history.push({ ts: anomaly.ts, event: 'duplicate', detail: { anomalyId: anomaly.id } });
      return wo;
    }

    const id = nextId();
    const playbook = playbookFor(anomaly.assetType, anomaly.failureMode);
    const parts = reserveParts(id, playbook.parts, inventory);
    const status = statusFor(parts);

    const wo = {
      id,
      assetId: anomaly.assetId,
      assetType: anomaly.assetType,
      failureMode: anomaly.failureMode,
      priority,
      slaHours: slaFor(priority),
      status,
      title: playbook.title,
      tasks: [...playbook.tasks],
      parts,
      occurrences: 1,
      anomalyIds: [anomaly.id],
      createdAt: anomaly.ts,
      lastSeen: anomaly.ts,
      history: [{ ts: anomaly.ts, event: 'created', detail: { priority, status } }],
      deduplicated: false,
    };

    wosById.set(id, wo);
    openIndex.set(key, id);
    return wo;
  }

  function close(id) {
    const wo = wosById.get(id);
    if (!wo) throw new Error(`F03: unknown work order id "${id}"`);
    if (wo.status === 'closed') return true;

    if (inventory) {
      inventory.consume(id); // AC-F03-4: consume reserved parts
    }
    wo.parts = wo.parts.map((p) => ({ ...p, reserved: 0 }));
    wo.status = 'closed';
    wo.history.push({ ts: wo.lastSeen, event: 'closed', detail: {} });

    const key = `${wo.assetId}::${wo.failureMode}`;
    if (openIndex.get(key) === id) {
      openIndex.delete(key); // frees the slot so a new WO can open
    }
    return true;
  }

  function list() {
    return [...wosById.values()];
  }

  function get(id) {
    return wosById.get(id);
  }

  return { fromAnomaly, close, list, get };
}
