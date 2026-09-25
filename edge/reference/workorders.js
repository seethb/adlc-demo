// F03 — Automated work orders from anomalies (reference implementation).
// Spec: specs/features/F03-work-orders.spec.md
// critical→P1, high→P2, medium→P3, low→no WO (AC-F03-1). One open WO per
// asset + failure mode; repeats escalate instead of duplicating (AC-F03-2).
// Parts are reserved in inventory when the WO is raised (AC-F03-3).

export const PLAYBOOKS = {
  bearing_wear:     { tasks: ['Confirm with envelope/spectrum analysis', 'Plan bearing replacement at next stop', 'Re-grease and verify lubrication interval'], parts: { motor: [['BRG-6309', 2]], centrifugal_pump: [['BRG-6309', 2]], shaft: [['BRG-6205', 2]], gearbox: [['BRG-6205', 2]], centrifugal_compressor: [['BRG-6309', 2]] } },
  winding_overheat: { tasks: ['Check phase balance and supply voltage', 'Clean cooling fins / verify fan', 'Megger test windings; re-varnish if IR < 100 MΩ'], parts: { motor: [['VRN-F', 1]] } },
  cavitation:       { tasks: ['Verify suction valve fully open, clean strainer', 'Check NPSH available vs required', 'Inspect impeller for pitting'], parts: { centrifugal_pump: [['SEAL-M42', 1], ['IMP-250', 1]] } },
  misalignment:     { tasks: ['Laser-align coupling (target < 0.05 mm)', 'Check soft foot', 'Replace coupling insert'], parts: { shaft: [['SHIM-KIT', 1], ['CPL-INS', 1]], motor: [['SHIM-KIT', 1], ['CPL-INS', 1]], centrifugal_pump: [['SHIM-KIT', 1], ['CPL-INS', 1]] } },
  imbalance:        { tasks: ['Two-plane field balance', 'Inspect rotor for build-up or erosion'], parts: { motor: [['BAL-WT', 1]], centrifugal_pump: [['BAL-WT', 1]], shaft: [['BAL-WT', 1]], centrifugal_compressor: [['BAL-WT', 1]] } },
  surge:            { tasks: ['Verify anti-surge controller and valve stroke', 'Check inlet guide vanes and filter ΔP', 'Review load-sharing setpoints'], parts: { centrifugal_compressor: [['AVV-DN50', 1]] } },
  lubrication:      { tasks: ['Oil sample for ferrography', 'Change oil and filter', 'Inspect gear mesh for pitting'], parts: { gearbox: [['OIL-ISO220', 1], ['FLT-OIL', 1]] } },
  unknown:          { tasks: ['Field inspection by reliability engineer'], parts: {} },
};

const PRIORITY = { critical: 'P1', high: 'P2', medium: 'P3' };
const SLA_HOURS = { P1: 4, P2: 24, P3: 72, P4: 168 };
const bump = p => ({ P3: 'P2', P2: 'P1', P1: 'P1' }[p] ?? p);

export function createWorkOrderService({ inventory } = {}) {
  const orders = [];
  let seq = 1000;

  function fromAnomaly(anomaly) {
    const priority = PRIORITY[anomaly.severity];
    if (!priority) return null;
    const open = orders.find(o => o.status !== 'closed' && o.assetId === anomaly.assetId && o.failureMode === anomaly.failureMode);
    if (open) {
      open.occurrences += 1;
      open.anomalyIds.push(anomaly.id);
      open.lastSeen = anomaly.ts;
      const escalated = PRIORITY[anomaly.severity] < open.priority ? PRIORITY[anomaly.severity] : open.occurrences % 5 === 0 ? bump(open.priority) : open.priority;
      if (escalated !== open.priority) { open.history.push({ ts: anomaly.ts, event: `escalated ${open.priority}→${escalated}` }); open.priority = escalated; open.slaHours = SLA_HOURS[escalated]; }
      return { ...open, deduplicated: true };
    }
    const pb = PLAYBOOKS[anomaly.failureMode] ?? PLAYBOOKS.unknown;
    const id = `WO-${++seq}`;
    const parts = (pb.parts[anomaly.assetType] ?? []).map(([sku, qty]) => {
      const r = inventory ? inventory.reserve(sku, qty, id) : { ok: true, reserved: qty, shortfall: 0 };
      return { sku, qty, reserved: r.reserved, shortfall: r.shortfall };
    });
    const wo = {
      id,
      assetId: anomaly.assetId,
      assetType: anomaly.assetType,
      failureMode: anomaly.failureMode,
      priority,
      slaHours: SLA_HOURS[priority],
      status: parts.some(p => p.shortfall > 0) ? 'waiting_parts' : 'open',
      title: `${anomaly.failureMode.replace(/_/g, ' ')} on ${anomaly.assetId}`,
      tasks: pb.tasks,
      parts,
      occurrences: 1,
      anomalyIds: [anomaly.id],
      createdAt: anomaly.ts,
      lastSeen: anomaly.ts,
      history: [{ ts: anomaly.ts, event: `raised from ${anomaly.id} (${anomaly.severity}, ${anomaly.rule})` }],
    };
    orders.push(wo);
    return { ...wo, deduplicated: false };
  }

  function close(id, { consumeParts = true } = {}) {
    const wo = orders.find(o => o.id === id);
    if (!wo || wo.status === 'closed') return false;
    if (inventory) (consumeParts ? inventory.consume(id) : inventory.release(id));
    wo.status = 'closed';
    wo.history.push({ ts: new Date().toISOString(), event: 'closed' });
    return true;
  }

  return { fromAnomaly, close, list: () => orders.map(o => ({ ...o })), get: id => orders.find(o => o.id === id) };
}
