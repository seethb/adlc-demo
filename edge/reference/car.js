// F04 — Corrective Action Reports (reference implementation).
// Spec: specs/features/F04-corrective-action.spec.md
// A CAR opens when a WO is P1 (AC-F04-1) or the same asset + failure mode
// recurs — two or more WOs, or one WO seen three or more times (AC-F04-2).
// At most one CAR per asset + failure mode (AC-F04-3). Fields follow 8D.

export const ROOT_CAUSES = {
  bearing_wear: 'Lubrication interval exceeded or contaminated grease leading to raceway fatigue',
  winding_overheat: 'Blocked cooling path or phase imbalance raising I²R losses beyond class F rating',
  cavitation: 'Net positive suction head available below required — suction restriction or low sump level',
  misalignment: 'Coupling offset beyond 0.1 mm after maintenance; soft foot not corrected',
  imbalance: 'Mass imbalance from rotor build-up or lost balance weight',
  surge: 'Operating point crossed surge line — anti-surge valve response too slow',
  lubrication: 'Oil degradation and particle ingress; filter bypass',
  unknown: 'Under investigation',
};

const PREVENTIVE = {
  bearing_wear: 'Move to condition-based greasing driven by bearing-temp trend',
  winding_overheat: 'Add winding-temp trend alarm at 100 °C and quarterly thermography',
  cavitation: 'Add suction-pressure low alarm and strainer ΔP monitoring',
  misalignment: 'Mandate laser alignment sign-off in the maintenance procedure',
  imbalance: 'Add balancing check to annual outage scope',
  surge: 'Retune anti-surge controller; add surge-margin pre-alarm at 12 %',
  lubrication: 'Monthly oil analysis with particle-count trend',
  unknown: 'Define monitoring once root cause is confirmed',
};

export function createCarService() {
  const cars = [];
  let seq = 0;

  function evaluate(workOrders) {
    const created = [];
    const groups = new Map();
    for (const wo of workOrders) {
      const key = `${wo.assetId}|${wo.failureMode}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(wo);
    }
    for (const [key, wos] of groups) {
      if (cars.some(c => c.key === key)) continue;
      const p1 = wos.find(w => w.priority === 'P1');
      const recurring = wos.length >= 2 || wos.some(w => w.occurrences >= 3);
      if (!p1 && !recurring) continue;
      const [assetId, failureMode] = key.split('|');
      const car = {
        id: `CAR-${String(++seq).padStart(3, '0')}`,
        key,
        assetId,
        failureMode,
        trigger: p1 ? 'critical-failure' : 'recurrence',
        workOrders: wos.map(w => w.id),
        status: 'open',
        owner: 'Reliability engineering',
        openedAt: wos[wos.length - 1].lastSeen ?? wos[wos.length - 1].createdAt,
        d2_problem: `${failureMode.replace(/_/g, ' ')} on ${assetId} — ${wos.length} work order(s), ${wos.reduce((n, w) => n + (w.occurrences ?? 1), 0)} anomaly occurrence(s)`,
        d3_containment: p1 ? 'Reduce load / switch to standby unit until repaired' : 'Increase inspection frequency to every shift',
        d4_rootCause: ROOT_CAUSES[failureMode] ?? ROOT_CAUSES.unknown,
        d5_corrective: wos[0].tasks ?? [],
        d7_preventive: PREVENTIVE[failureMode] ?? PREVENTIVE.unknown,
      };
      cars.push(car);
      created.push(car);
    }
    return created;
  }

  return { evaluate, list: () => cars.map(c => ({ ...c })) };
}
