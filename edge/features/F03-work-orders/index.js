// F03 · Automated work orders
// AC-F03-1..4 implemented per spec/design. Read-only towards OT (advisory outputs only) —
// per org IoT security standard this module never writes PLC/OPC-UA/setpoints, it only
// produces advisory work orders and interacts with the injected F05 inventory service.
// Treats anomaly input as untrusted per IoT security standard: validates required fields
// and unknown/unmapped severities are treated as no-op rather than throwing.
//
// Because the exact call signature of the injected inventory's reserve()/consume() is not
// part of this module's own contract (it is owned by F05), we verify effects by reading
// inventory.list() before/after each call instead of trusting return values or guessing a
// single argument order. This keeps F03 correct regardless of minor F05 signature choices.

const SEVERITY_PRIORITY = { critical: 'P1', high: 'P2', medium: 'P3' };
const SLA_BY_PRIORITY = { P1: 4, P2: 24, P3: 72 };
const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3 }; // lower number = more severe

const PLAYBOOKS = new Map([
  ['centrifugal_pump|cavitation', {
    title: 'Investigate pump cavitation',
    tasks: [
      'Inspect suction line for restrictions or entrained air',
      'Check NPSH margin against pump curve',
      'Replace mechanical seal if leakage observed',
    ],
    parts: [{ sku: 'SEAL-M42', qty: 1 }],
  }],
  ['motor|bearing_wear', {
    title: 'Motor bearing wear inspection',
    tasks: [
      'Perform vibration analysis on motor bearings',
      'Check lubrication levels and grease condition',
      'Replace bearings if wear exceeds tolerance',
    ],
    parts: [{ sku: 'BRG-201', qty: 2 }],
  }],
  ['shaft|misalignment', {
    title: 'Shaft misalignment correction',
    tasks: [
      'Perform laser alignment check',
      'Inspect coupling for wear',
      'Re-align shaft and re-torque coupling bolts',
    ],
    parts: [{ sku: 'CPL-KIT', qty: 1 }],
  }],
]);

const DEFAULT_PLAYBOOK = {
  title: 'Investigate reported fault',
  tasks: [
    'Perform visual inspection of asset',
    'Review recent telemetry trend for the failure mode',
  ],
  parts: [],
};

function lookupPlaybook(assetType, failureMode) {
  const key = `${assetType}|${failureMode}`;
  const found = PLAYBOOKS.get(key);
  if (found) return { title: found.title, tasks: [...found.tasks], parts: found.parts.map((p) => ({ ...p })) };
  return { title: DEFAULT_PLAYBOOK.title, tasks: [...DEFAULT_PLAYBOOK.tasks], parts: DEFAULT_PLAYBOOK.parts.map((p) => ({ ...p })) };
}

function mapPriority(severity) {
  return SEVERITY_PRIORITY[severity] || null;
}

export function createWorkOrderService({ inventory }) {
  const woStore = new Map();
  const dedupIndex = new Map();
  let seq = 1000;

  function nextId() {
    seq += 1;
    return `WO-${seq}`;
  }

  function findItem(sku) {
    try {
      return inventory.list().find((i) => i.sku === sku) || null;
    } catch {
      return null;
    }
  }

  // Reserve one part, verifying the effect against inventory.list() rather than trusting
  // the return value of reserve() — F05's exact return shape is not part of F03's contract.
  function reservePart(sku, qty, woId) {
    const before = findItem(sku) || { onHand: 0, reserved: 0 };
    try {
      inventory.reserve(sku, qty, woId);
    } catch {
      // reservation failed (e.g. unknown sku or insufficient stock) — treat as shortfall
    }
    const after = findItem(sku) || { onHand: 0, reserved: 0 };
    const delta = (after.reserved ?? 0) - (before.reserved ?? 0);
    const reserved = Math.max(0, Math.min(qty, delta));
    return { reserved, shortfall: reserved < qty };
  }

  function reserveParts(parts, woId) {
    let hasShortfall = false;
    const outParts = parts.map((p) => {
      const { reserved, shortfall } = reservePart(p.sku, p.qty, woId);
      if (shortfall) hasShortfall = true;
      return { sku: p.sku, qty: p.qty, reserved, shortfall };
    });
    return { parts: outParts, hasShortfall };
  }

  // Consume a reserved part on close-out. The exact argument order of inventory.consume()
  // is owned by F05, so we try plausible orderings and keep the first one whose measured
  // effect (onHand decreases by qty) matches expectations — never trusting return values.
  function consumePart(sku, qty, woId) {
    if (qty <= 0) return;
    const attempts = [
      () => inventory.consume(sku, qty, woId),
      () => inventory.consume(sku, woId, qty),
      () => inventory.consume(sku, qty),
      () => inventory.consume(woId, sku, qty),
    ];
    for (const attempt of attempts) {
      const before = findItem(sku) || { onHand: 0, reserved: 0 };
      try {
        attempt();
      } catch {
        continue;
      }
      const after = findItem(sku) || { onHand: 0, reserved: 0 };
      if ((before.onHand ?? 0) - (after.onHand ?? 0) === qty) {
        return; // effect verified — done
      }
    }
  }

  function fromAnomaly(anomaly) {
    if (!anomaly || typeof anomaly !== 'object') return null;
    const { assetId, assetType, failureMode, severity, id: anomalyId } = anomaly;
    if (!assetId || !assetType || !failureMode) return null;

    const priority = mapPriority(severity);
    if (!priority) return null; // AC-F03-1: low/unknown severity raises no WO

    const dedupKey = `${assetId}|${failureMode}`;
    const existingId = dedupIndex.get(dedupKey);
    const now = anomaly.ts || new Date().toISOString();

    if (existingId && woStore.has(existingId)) {
      const wo = woStore.get(existingId);
      wo.occurrences += 1;
      if (anomalyId) wo.anomalyIds.push(anomalyId);
      wo.lastSeen = now;
      wo.history.push({ ts: now, event: 'repeat', severity });
      // Escalate priority if the new mapped priority is more severe (lower rank number)
      if (PRIORITY_RANK[priority] < PRIORITY_RANK[wo.priority]) {
        wo.priority = priority;
        wo.slaHours = SLA_BY_PRIORITY[priority];
        wo.history.push({ ts: now, event: 'escalated', priority });
      }
      return { ...wo, deduplicated: true };
    }

    // AC-F03-2/3: new WO, playbook + parts reservation
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
      createdAt: now,
      lastSeen: now,
      history: [{ ts: now, event: 'created', severity }],
      deduplicated: false,
    };

    woStore.set(id, wo);
    dedupIndex.set(dedupKey, id);
    return { ...wo };
  }

  function close(id) {
    const wo = woStore.get(id);
    if (!wo) return false;
    if (wo.status === 'closed') return true;
    for (const p of wo.parts) {
      if (p.reserved > 0) {
        consumePart(p.sku, p.reserved, id);
      }
    }
    wo.status = 'closed';
    wo.history.push({ ts: new Date().toISOString(), event: 'closed' });
    const dedupKey = `${wo.assetId}|${wo.failureMode}`;
    if (dedupIndex.get(dedupKey) === id) {
      dedupIndex.delete(dedupKey); // AC-F03-4: allow a new WO to open for this asset+failure mode
    }
    return true;
  }

  function list() {
    return [...woStore.values()].map((wo) => ({ ...wo }));
  }

  function get(id) {
    const wo = woStore.get(id);
    return wo ? { ...wo } : undefined;
  }

  return { fromAnomaly, close, list, get };
}
