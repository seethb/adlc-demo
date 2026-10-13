// F04 Corrective Action Reports (CAR) — edge/features/F04-corrective-action/index.js
// Implements AC-F04-1..AC-F04-4. No deps, no I/O, no network.

const ROOT_CAUSE_HANDBOOK = {
  cavitation: 'Cavitation caused by insufficient NPSH margin or suction restriction.',
  bearing: 'Bearing wear from lubrication breakdown or misalignment.',
  overheat: 'Overheating from blocked cooling path or excess load.',
  vibration: 'Excess vibration from imbalance or coupling misalignment.',
};

function lookupRootCause(failureMode) {
  // AC-F04-4: d4_rootCause must always be non-empty; falls back to a clearly
  // marked, unconfirmed hypothesis rather than inventing a fact (see Risks).
  return (
    ROOT_CAUSE_HANDBOOK[failureMode] ||
    `hypothesis: ${failureMode} — unconfirmed, pending inspection`
  );
}

function keyOf(wo) {
  return `${wo.assetId}|${wo.failureMode}`;
}

function isCritical(wo) {
  return wo.priority === 'P1';
}

function isRecurrence(group) {
  // AC-F04-2: two or more WOs, or one WO seen three or more times.
  if (group.length >= 2) return true;
  return group.some((wo) => Number(wo.occurrences) >= 3);
}

export function createCarService() {
  const cars = [];
  const seenKeys = new Set();
  let seq = 0;

  function nextId() {
    seq += 1;
    return `CAR-${String(seq).padStart(3, '0')}`;
  }

  function buildCar(wo, trigger, group) {
    const totalOccurrences = group.reduce(
      (sum, w) => sum + (Number(w.occurrences) || 0),
      0
    );
    const containment =
      wo.priority === 'P1'
        ? 'Reduce load or switch to standby unit immediately.'
        : 'Increase inspection frequency to every shift.';
    const tasks =
      Array.isArray(wo.tasks) && wo.tasks.length > 0
        ? wo.tasks
        : [`Investigate ${wo.failureMode} on ${wo.assetId}`];

    return {
      id: nextId(),
      assetId: wo.assetId,
      failureMode: wo.failureMode,
      trigger,
      workOrders: group.map((w) => w.id),
      status: 'open',
      createdAt: new Date().toISOString(),
      d1_team: 'reliability engineering',
      d2_problem: `Asset ${wo.assetId} failure mode '${wo.failureMode}': ${group.length} work order(s), ${totalOccurrences} total occurrence(s).`,
      d3_containment: containment,
      d4_rootCause: lookupRootCause(wo.failureMode),
      d5_corrective: tasks,
      d6_verify: '7 days without recurrence',
      d7_preventive: `Add monitoring/procedure change to prevent recurrence of ${wo.failureMode} on ${wo.assetId}.`,
    };
  }

  function evaluate(workOrders) {
    const created = [];
    const groups = new Map();

    for (const wo of workOrders || []) {
      if (!wo || !wo.assetId || !wo.failureMode) continue; // defensive: skip malformed input
      const key = keyOf(wo);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(wo);
    }

    for (const [key, group] of groups) {
      if (seenKeys.has(key)) continue; // AC-F04-3: at most one CAR per asset+failureMode

      const criticalWo = group.find(isCritical);
      let trigger = null;
      let representative = null;

      if (criticalWo) {
        trigger = 'critical-failure'; // AC-F04-1
        representative = criticalWo;
      } else if (isRecurrence(group)) {
        trigger = 'recurrence'; // AC-F04-2
        representative = group[0];
      }

      if (!trigger) continue;

      const car = buildCar(representative, trigger, group);
      cars.push(car);
      seenKeys.add(key);
      created.push(car);
    }

    return created;
  }

  function list() {
    return cars.slice();
  }

  return { evaluate, list };
}
