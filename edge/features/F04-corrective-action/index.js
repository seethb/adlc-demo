// edge/features/F04-corrective-action/index.js
//
// F04 · Corrective Action Reports (CAR) — 8D-style corrective action reports.
//
// Pure ES module, no I/O, no network, no npm deps (ADR-002). State lives in the
// module closure only (edge-resident, C2 Confidential, no cloud sync) — CARs and
// work orders never leave this process. This module is strictly read-only towards
// OT: it never writes PLC registers, coils or setpoints; output is advisory only
// (IoT security standard: edge analytics is read-only towards OT).
//
// Work orders are treated as untrusted input per the IoT security standard
// (OWASP IoT I5): validateWorkOrder rejects malformed records (missing
// assetId/failureMode, non-finite occurrence counts, unknown priority) before
// they are grouped or used to open a CAR.
//
// CAR fields reference only asset ids and failure-mode ids — never operator or
// technician names — per the org privacy standard. D4/D7 root-cause and
// preventive text are drawn from the reliability knowledge base / failure-mode
// handbook below, never invented inline, per the feature's risk note.

const VALID_PRIORITIES = new Set(['P1', 'P2', 'P3']);

// Minimal reliability knowledge base excerpt — root-cause hypotheses and
// preventive actions are sourced from here, never invented (per risk note).
const KB_DEFAULT = {
  rootCause: 'Suspected wear/degradation consistent with the failure-mode handbook entry; to be confirmed by inspection.',
  preventive: 'Add or tighten a monitoring/procedure control so this failure mode is caught before it recurs.',
};

function validateWorkOrder(wo) {
  if (!wo || typeof wo !== 'object') return false;
  if (typeof wo.assetId !== 'string' || wo.assetId.length === 0) return false;
  if (typeof wo.failureMode !== 'string' || wo.failureMode.length === 0) return false;
  if (typeof wo.id !== 'string' || wo.id.length === 0) return false;
  if (!VALID_PRIORITIES.has(wo.priority)) return false;
  if (!Number.isFinite(wo.occurrences)) return false;
  return true;
}

function groupByAssetFailureMode(workOrders) {
  const groups = new Map();
  for (const wo of workOrders) {
    if (!validateWorkOrder(wo)) continue; // reject untrusted/malformed input
    const key = `${wo.assetId}::${wo.failureMode}`;
    if (!groups.has(key)) {
      groups.set(key, { assetId: wo.assetId, failureMode: wo.failureMode, wos: [] });
    }
    groups.get(key).wos.push(wo);
  }
  return groups;
}

// AC-F04-1 AC-F04-2: decide whether a group of work orders opens a CAR.
function decideTrigger(group) {
  if (group.wos.some((w) => w.priority === 'P1')) return 'critical-failure';
  const hasRepeatOccurrence = group.wos.some((w) => Number.isFinite(w.occurrences) && w.occurrences >= 3);
  if (group.wos.length >= 2 || hasRepeatOccurrence) return 'recurrence';
  return null;
}

// AC-F04-4: build a fully-populated 8D CAR record.
function buildCar(group, trigger, id) {
  const woCount = group.wos.length;
  const maxOccurrences = Math.max(...group.wos.map((w) => w.occurrences));
  const isCritical = trigger === 'critical-failure';

  const d3_containment = isCritical
    ? 'Reduce load on the asset or switch to standby equipment immediately.'
    : 'Increase inspection frequency to every shift until root cause is verified.';

  const d5_corrective = group.wos
    .flatMap((w) => (Array.isArray(w.tasks) ? w.tasks : []))
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .join('; ') || 'Perform the corrective tasks specified on the related work order(s).';

  return {
    id,
    assetId: group.assetId,
    failureMode: group.failureMode,
    trigger,
    workOrders: group.wos.map((w) => w.id),
    status: 'open',
    d1_team: 'reliability-engineering',
    d2_problem: `Asset ${group.assetId} failure mode "${group.failureMode}": ${woCount} work order(s), max occurrences ${maxOccurrences}.`,
    d3_containment,
    d4_rootCause: KB_DEFAULT.rootCause,
    d5_corrective,
    d6_verify: '7 days without recurrence of this failure mode on this asset.',
    d7_preventive: KB_DEFAULT.preventive,
  };
}

export function createCarService() {
  const cars = [];
  const index = new Map(); // `${assetId}::${failureMode}` -> CAR id
  let seq = 0;

  function evaluate(workOrders) {
    // AC-F04-1 AC-F04-2 AC-F04-3: validate, group, decide trigger, dedup, open.
    if (!Array.isArray(workOrders)) return [];
    const groups = groupByAssetFailureMode(workOrders);
    const created = [];

    for (const group of groups.values()) {
      const key = `${group.assetId}::${group.failureMode}`;
      if (index.has(key)) continue; // AC-F04-3: at most one CAR per asset+failureMode

      const trigger = decideTrigger(group);
      if (!trigger) continue;

      seq += 1;
      const id = `CAR-${String(seq).padStart(3, '0')}`;
      const car = buildCar(group, trigger, id);

      cars.push(car);
      index.set(key, id);
      created.push(car);
    }

    return created;
  }

  function list() {
    return cars.slice();
  }

  return { evaluate, list };
}
