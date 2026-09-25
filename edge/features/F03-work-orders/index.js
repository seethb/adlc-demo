// edge/features/F03-work-orders/index.js
// F03 — Automated work orders. Pure ES module, no I/O, no network, no env, no eval.
// Only dependency is the injected `inventory` collaborator (F05) — no external imports needed.

'use strict';

// AC-F03-1: severity → priority mapping. Low severity never raises a WO.
const SEVERITY_TO_PRIORITY = Object.freeze({
  critical: 'P1',
  high: 'P2',
  medium: 'P3',
});

const PRIORITY_RANK = Object.freeze({ P1: 1, P2: 2, P3: 3 });

const SLA_HOURS = Object.freeze({ P1: 4, P2: 24, P3: 72 });

// Static playbook lookup: failureMode -> { tasks[], parts:[{sku,qty}] }.
// AC-F03-3: a WO carries the playbook tasks and reserves its parts.
// Only SKUs known to be valid in the reference inventory (F05) are used here;
// unrecognised SKUs are tolerated defensively in reserveParts (see below) so a
// bad/missing catalogue entry never crashes WO creation — it just shows up as
// a shortfall (per spec risk note: "parts shortfall must not block WO creation").
const PLAYBOOKS = Object.freeze({
  cavitation: {
    tasks: [
      'Inspect impeller for cavitation damage',
      'Check suction pressure and NPSH margin',
      'Replace mechanical seal',
    ],
    parts: [{ sku: 'SEAL-M42', qty: 1 }],
  },
  bearing_wear: {
    tasks: [
      'Inspect bearing for wear/pitting',
      'Check lubrication and vibration levels',
      'Replace bearing assembly',
    ],
    parts: [{ sku: 'BRG-6205', qty: 1 }],
  },
  misalignment: {
    tasks: [
      'Perform laser shaft alignment check',
      'Inspect coupling for wear',
      'Realign shaft to specification',
    ],
    // No dedicated catalogue SKU verified for this failure mode — request no
    // parts rather than risk referencing an unknown SKU (see reserveParts
    // defensive handling below for any playbook that does reference one).
    parts: [],
  },
  default: {
    tasks: [
      'Inspect asset for reported anomaly',
      'Perform diagnostic checks',
      'Schedule corrective maintenance',
    ],
    parts: [],
  },
});

function playbookFor(assetType, failureMode) {
  return PLAYBOOKS[failureMode] || PLAYBOOKS.default;
}

function mapSeverityToPriority(severity) {
  return SEVERITY_TO_PRIORITY[severity] || null;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

/**
 * createWorkOrderService — AC-F03-1..4
 * @param {{ inventory: object }} deps
 */
export function createWorkOrderService({ inventory }) {
  if (!inventory) {
    throw new TypeError('createWorkOrderService requires an { inventory } dependency');
  }

  const woStore = new Map(); // id -> WO
  const openIndex = new Map(); // 'assetId::failureMode' -> id (only while open/waiting_parts)
  let seq = 1;

  function nextId() {
    return `WO-${1000 + seq++}`;
  }

  function touchHistory(wo, event) {
    wo.history.push({ at: new Date().toISOString(), event });
  }

  // Attempt to reserve one part line against inventory (F05). Unknown SKUs or
  // insufficient stock never throw out of WO creation — they are recorded as
  // a shortfall instead, per spec: "shortfall must not block WO creation".
  function reservePartLine(sku, qty) {
    let reserved = 0;
    try {
      if (typeof inventory.reserve === 'function') {
        const res = inventory.reserve(sku, qty);
        if (res === true) {
          reserved = qty;
        } else if (res === false || res === undefined || res === null) {
          reserved = 0;
        } else if (typeof res === 'object') {
          if (typeof res.reserved === 'number') reserved = res.reserved;
          else if (res.ok === true) reserved = qty;
        }
      }
    } catch {
      // Unknown SKU / rejected by inventory: treat as full shortfall.
      reserved = 0;
    }
    const shortfall = Math.max(0, qty - reserved);
    return { sku, qty, reserved, shortfall };
  }

  function reserveParts(partsNeeded) {
    const parts = partsNeeded.map(({ sku, qty }) => reservePartLine(sku, qty));
    const waiting = parts.some((p) => p.shortfall > 0);
    return { parts, waiting };
  }

  // Consume the reserved quantity for a part line on WO close (AC-F03-4).
  function consumePartLine(sku, qty) {
    if (!qty || qty <= 0) return;
    try {
      if (typeof inventory.consume === 'function') {
        inventory.consume(sku, qty);
      } else if (typeof inventory.issue === 'function') {
        inventory.issue(sku, qty);
      } else if (typeof inventory.release === 'function') {
        inventory.release(sku, qty);
      }
    } catch {
      // Best-effort consumption; never let close() throw due to catalogue drift.
    }
  }

  function priorityRank(p) {
    return PRIORITY_RANK[p] || 99;
  }

  function fromAnomaly(anomaly) {
    if (!anomaly || typeof anomaly !== 'object') {
      throw new TypeError('fromAnomaly requires an anomaly object');
    }
    const { assetId, assetType, failureMode, severity } = anomaly;
    if (!isNonEmptyString(assetId) || !isNonEmptyString(assetType) || !isNonEmptyString(failureMode)) {
      throw new TypeError('anomaly missing required assetId/assetType/failureMode');
    }

    const priority = mapSeverityToPriority(severity);
    // AC-F03-1: low (or unknown) severity raises no WO.
    if (!priority) return null;

    const key = `${assetId}::${failureMode}`;
    const existingId = openIndex.get(key);

    if (existingId) {
      // AC-F03-2: dedup — increment occurrences, escalate priority if more severe.
      const wo = woStore.get(existingId);
      wo.occurrences += 1;
      wo.lastSeen = anomaly.ts || new Date().toISOString();
      if (isNonEmptyString(anomaly.id)) wo.anomalyIds.push(anomaly.id);
      if (priorityRank(priority) < priorityRank(wo.priority)) {
        wo.priority = priority;
        wo.slaHours = SLA_HOURS[priority];
        touchHistory(wo, `priority escalated to ${priority}`);
      }
      touchHistory(wo, 'duplicate anomaly observed');
      return { ...wo, deduplicated: true };
    }

    // New work order: AC-F03-3 — attach playbook tasks and reserve parts.
    const { tasks, parts: partsNeeded } = playbookFor(assetType, failureMode);
    const { parts, waiting } = reserveParts(partsNeeded);

    const id = nextId();
    const now = anomaly.ts || new Date().toISOString();
    const wo = {
      id,
      assetId,
      assetType,
      failureMode,
      priority,
      slaHours: SLA_HOURS[priority],
      status: waiting ? 'waiting_parts' : 'open',
      title: `${failureMode.replace(/_/g, ' ')} on ${assetId}`,
      tasks: [...tasks],
      parts,
      occurrences: 1,
      anomalyIds: isNonEmptyString(anomaly.id) ? [anomaly.id] : [],
      createdAt: now,
      lastSeen: now,
      history: [],
      deduplicated: false,
    };
    touchHistory(wo, 'created');

    woStore.set(id, wo);
    openIndex.set(key, id);

    return { ...wo };
  }

  function close(id) {
    const wo = woStore.get(id);
    if (!wo) throw new Error(`unknown work order id: ${id}`);
    if (wo.status === 'closed') throw new Error(`work order already closed: ${id}`);

    // AC-F03-4: consume exactly the reserved quantity per part on close.
    for (const p of wo.parts) {
      consumePartLine(p.sku, p.reserved);
      p.reserved = 0;
    }

    wo.status = 'closed';
    touchHistory(wo, 'closed');

    const key = `${wo.assetId}::${wo.failureMode}`;
    if (openIndex.get(key) === id) {
      openIndex.delete(key); // AC-F03-4: a new WO may now open for this asset+failure mode
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
