// F04 · Corrective Action Reports (CAR)
// Reference: specs/features/F04-corrective-action/{plan,design}.md
// Org standard: no npm deps, no I/O, no network, no process.env, no eval.
// Only node: built-ins or '../../reference/fleet.js' may be imported — this module needs neither.

// Small internal root-cause handbook. Per design doc, root-cause text must come from a
// handbook, never be invented; unknown failure modes get an explicit "(unconfirmed)" tag.
const ROOT_CAUSE_HANDBOOK = {
  'cavitation': 'Insufficient NPSH margin leading to vapor bubble collapse at the impeller.',
  'bearing-wear': 'Lubrication breakdown or misalignment accelerating bearing wear.',
  'overheating': 'Reduced cooling flow or fouled heat-transfer surface.',
  'vibration': 'Mechanical imbalance or coupling misalignment.',
};

function lookupRootCause(failureMode) {
  return ROOT_CAUSE_HANDBOOK[failureMode] || `Root cause for '${failureMode}' not yet confirmed (unconfirmed).`;
}

function keyOf(wo) {
  return `${wo.assetId}|${wo.failureMode}`;
}

function isCritical(wo) {
  return wo.priority === 'P1';
}

function isRecurrent(group) {
  return group.length >= 2 || group.some((wo) => (Number.isFinite(wo.occurrences) ? wo.occurrences : 1) >= 3);
}

function groupByKey(workOrders) {
  const groups = new Map();
  for (const wo of workOrders) {
    if (!wo || !wo.assetId || !wo.failureMode || !wo.priority) continue; // AC input validation
    const key = keyOf(wo);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(wo);
  }
  return groups;
}

export function createCarService() {
  const cars = new Map(); // CAR-nnn -> CAR
  const byKey = new Map(); // assetId|failureMode -> CAR-nnn
  let seq = 1;

  function buildCar(key, group, trigger) {
    const [assetId, failureMode] = key.split('|');
    const id = `CAR-${String(seq).padStart(3, '0')}`;
    seq += 1;

    const woIds = group.map((wo) => wo.id);
    const totalOccurrences = group.reduce(
      (sum, wo) => sum + (Number.isFinite(wo.occurrences) ? wo.occurrences : 1),
      0,
    );
    const tasks = [...new Set(group.flatMap((wo) => (Array.isArray(wo.tasks) ? wo.tasks : [])))];
    const anyCritical = group.some(isCritical);

    const car = {
      id,
      assetId,
      failureMode,
      trigger,
      workOrders: woIds,
      status: 'open',
      createdAt: new Date().toISOString(),
      // 8D fields — AC-F04-4: every field must be filled in.
      d1_team: 'Reliability engineering',
      d2_problem: `Asset ${assetId} failure mode '${failureMode}' observed across ${group.length} work order(s), ${totalOccurrences} occurrence(s).`,
      d3_containment: anyCritical
        ? 'Reduce load or switch to standby equipment immediately.'
        : 'Increase inspection frequency to every shift.',
      d4_rootCause: lookupRootCause(failureMode),
      d5_corrective: tasks.length > 0 ? tasks.join('; ') : 'Apply standard corrective playbook tasks.',
      d6_verify: 'Verify no recurrence for 7 consecutive days.',
      d7_preventive: `Add monitoring/procedure change to detect '${failureMode}' on ${assetId} earlier.`,
      d8_closure: 'Pending verification period before closure.',
    };
    return car;
  }

  function evaluate(workOrders) {
    const groups = groupByKey(Array.isArray(workOrders) ? workOrders : []);
    const created = [];

    for (const [key, group] of groups) {
      if (byKey.has(key)) continue; // AC-F04-3: at most one CAR per asset + failure mode

      let trigger = null;
      if (group.some(isCritical)) {
        trigger = 'critical-failure'; // AC-F04-1
      } else if (isRecurrent(group)) {
        trigger = 'recurrence'; // AC-F04-2
      }

      if (!trigger) continue;

      const car = buildCar(key, group, trigger);
      cars.set(car.id, car);
      byKey.set(key, car.id);
      created.push(car);
    }

    return created;
  }

  function list() {
    return [...cars.values()];
  }

  return { evaluate, list };
}
