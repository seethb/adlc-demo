// F05 — Spare-parts inventory tracking (reference implementation).
// Spec: specs/features/F05-inventory.spec.md
// available = onHand − reserved. Reservations never drive `available` below
// zero (AC-F05-1); dropping to or under the reorder point raises exactly one
// open requisition per SKU (AC-F05-3).

export const PARTS = [
  { sku: 'BRG-6309', name: 'Deep-groove bearing 6309-2RS', onHand: 12, reorderPoint: 6, reorderQty: 12, leadTimeDays: 5, unitCost: 48 },
  { sku: 'BRG-6205', name: 'Deep-groove bearing 6205-2Z', onHand: 20, reorderPoint: 8, reorderQty: 20, leadTimeDays: 4, unitCost: 14 },
  { sku: 'SEAL-M42', name: 'Mechanical seal 42 mm cartridge', onHand: 4, reorderPoint: 2, reorderQty: 4, leadTimeDays: 10, unitCost: 410 },
  { sku: 'IMP-250', name: 'Closed impeller Ø250 duplex', onHand: 2, reorderPoint: 1, reorderQty: 2, leadTimeDays: 21, unitCost: 1850 },
  { sku: 'CPL-INS', name: 'Jaw coupling elastomer insert', onHand: 10, reorderPoint: 4, reorderQty: 10, leadTimeDays: 3, unitCost: 22 },
  { sku: 'SHIM-KIT', name: 'Laser-alignment shim kit', onHand: 3, reorderPoint: 1, reorderQty: 2, leadTimeDays: 7, unitCost: 95 },
  { sku: 'OIL-ISO220', name: 'Gear oil ISO VG 220 (20 L)', onHand: 6, reorderPoint: 3, reorderQty: 6, leadTimeDays: 2, unitCost: 160 },
  { sku: 'FLT-OIL', name: 'Gearbox oil filter element', onHand: 5, reorderPoint: 2, reorderQty: 6, leadTimeDays: 4, unitCost: 38 },
  { sku: 'VRN-F', name: 'Class F winding varnish kit', onHand: 2, reorderPoint: 1, reorderQty: 2, leadTimeDays: 14, unitCost: 260 },
  { sku: 'AVV-DN50', name: 'Anti-surge valve trim DN50', onHand: 1, reorderPoint: 1, reorderQty: 1, leadTimeDays: 30, unitCost: 3200 },
  { sku: 'BAL-WT', name: 'Balancing weight set', onHand: 8, reorderPoint: 3, reorderQty: 8, leadTimeDays: 3, unitCost: 30 },
];

export function createInventory(parts = PARTS) {
  const items = new Map(parts.map(p => [p.sku, { ...p, reserved: 0 }]));
  const reservations = []; // { sku, qty, ref }
  const requisitions = []; // { id, sku, qty, status, reason }
  let reqSeq = 0;

  const get = sku => {
    const it = items.get(sku);
    if (!it) throw new Error(`unknown sku ${sku}`);
    return it;
  };
  const available = sku => { const it = get(sku); return it.onHand - it.reserved; };

  function checkReorder(sku) {
    const it = get(sku);
    const open = requisitions.find(r => r.sku === sku && r.status === 'open');
    if (available(sku) <= it.reorderPoint && !open) {
      requisitions.push({ id: `PR-${String(++reqSeq).padStart(4, '0')}`, sku, qty: it.reorderQty, status: 'open', reason: `available ${available(sku)} ≤ reorder point ${it.reorderPoint}`, etaDays: it.leadTimeDays });
    }
  }

  function reserve(sku, qty, ref) {
    const got = Math.max(0, Math.min(qty, available(sku)));
    if (got > 0) { get(sku).reserved += got; reservations.push({ sku, qty: got, ref }); }
    checkReorder(sku);
    return { ok: got === qty, reserved: got, shortfall: qty - got };
  }

  function release(ref) {
    for (let i = reservations.length - 1; i >= 0; i--) {
      if (reservations[i].ref === ref) { get(reservations[i].sku).reserved -= reservations[i].qty; reservations.splice(i, 1); }
    }
  }

  // Issue reserved stock to the job: onHand and reserved both drop.
  function consume(ref) {
    for (let i = reservations.length - 1; i >= 0; i--) {
      const r = reservations[i];
      if (r.ref === ref) { const it = get(r.sku); it.onHand -= r.qty; it.reserved -= r.qty; reservations.splice(i, 1); checkReorder(r.sku); }
    }
  }

  function receive(reqId) {
    const req = requisitions.find(r => r.id === reqId && r.status === 'open');
    if (!req) return false;
    get(req.sku).onHand += req.qty;
    req.status = 'received';
    return true;
  }

  const list = () => [...items.values()].map(it => ({ ...it, available: it.onHand - it.reserved, low: it.onHand - it.reserved <= it.reorderPoint }));

  return { reserve, release, consume, receive, available, list, lowStock: () => list().filter(i => i.low), requisitions: () => requisitions.map(r => ({ ...r })), reservations: () => reservations.map(r => ({ ...r })) };
}
