// F05 · Spare-parts inventory tracking
// Org standard: pure ES module, no I/O/network/child_process/eval, no OT writes (ADR-001, IEC 62443 read-only).
// Telemetry/inputs treated as untrusted per IoT security standard: reject unknown skus/refs, non-finite/negative qty.

function isPositiveFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

export function createInventory(parts = []) {
  const stock = new Map(); // sku -> { name, onHand, reserved, reorderPoint, reorderQty }
  const reservations = new Map(); // ref -> { sku, qty }
  const openRequisitions = new Map(); // sku -> requisition object
  let reqSeq = 0;
  const allRequisitions = []; // preserves insertion order, includes closed ones

  for (const p of parts) {
    stock.set(p.sku, {
      name: p.name,
      onHand: p.onHand,
      reserved: 0,
      reorderPoint: p.reorderPoint,
      reorderQty: p.reorderQty,
      leadTimeDays: p.leadTimeDays,
      unitCost: p.unitCost,
    });
  }

  function assertKnownSku(sku) {
    if (!stock.has(sku)) throw new Error(`unknown sku: ${sku}`); // AC-F05-5
    return stock.get(sku);
  }

  function findReservation(ref) {
    const r = reservations.get(ref);
    if (!r) throw new Error(`unknown reservation ref: ${ref}`);
    return r;
  }

  function availableQty(sku) {
    const s = stock.get(sku);
    return s.onHand - s.reserved;
  }

  function maybeRequisition(sku) {
    const s = stock.get(sku);
    if (availableQty(sku) <= s.reorderPoint && !openRequisitions.has(sku)) {
      reqSeq += 1;
      const req = { id: `REQ-${reqSeq}`, sku, qty: s.reorderQty, status: 'open' };
      openRequisitions.set(sku, req);
      allRequisitions.push(req);
    }
  }

  function reserve(sku, qty, ref) {
    const s = assertKnownSku(sku);
    if (!isPositiveFiniteNumber(qty)) throw new Error('qty must be a positive finite number');
    if (typeof ref !== 'string' || ref.length === 0) throw new Error('ref must be a non-empty string');

    const availableNow = s.onHand - s.reserved;
    const grant = Math.max(0, Math.min(qty, availableNow));
    s.reserved += grant;

    if (grant > 0) {
      const existing = reservations.get(ref);
      if (existing && existing.sku === sku) {
        existing.qty += grant;
      } else {
        reservations.set(ref, { sku, qty: grant });
      }
    }

    maybeRequisition(sku); // AC-F05-3

    const shortfall = Math.max(0, qty - grant);
    return { ok: shortfall === 0, reserved: grant, shortfall };
  }

  function release(ref) {
    const r = findReservation(ref);
    const s = assertKnownSku(r.sku);
    s.reserved -= r.qty;
    reservations.delete(ref);
  }

  function consume(ref) {
    const r = findReservation(ref);
    const s = assertKnownSku(r.sku);
    s.onHand -= r.qty;
    s.reserved -= r.qty;
    reservations.delete(ref);
    maybeRequisition(r.sku); // AC-F05-3
  }

  function receive(reqId) {
    const req = allRequisitions.find(x => x.id === reqId && x.status === 'open');
    if (!req) return false;
    const s = assertKnownSku(req.sku);
    s.onHand += req.qty;
    req.status = 'received'; // AC-F05-4
    openRequisitions.delete(req.sku);
    return true;
  }

  function available(sku) {
    assertKnownSku(sku);
    return availableQty(sku);
  }

  function list() {
    return [...stock.entries()].map(([sku, s]) => ({
      sku,
      onHand: s.onHand,
      reserved: s.reserved,
      available: s.onHand - s.reserved,
    }));
  }

  function lowStock() {
    return [...stock.entries()]
      .filter(([sku, s]) => (s.onHand - s.reserved) <= s.reorderPoint)
      .map(([sku, s]) => ({ sku, available: s.onHand - s.reserved, reorderPoint: s.reorderPoint }));
  }

  function requisitions() {
    return allRequisitions.map(r => ({ ...r }));
  }

  function reservationsList() {
    return [...reservations.entries()].map(([ref, r]) => ({ ref, sku: r.sku, qty: r.qty }));
  }

  return {
    reserve,
    release,
    consume,
    receive,
    available,
    list,
    lowStock,
    requisitions,
    reservations: reservationsList,
  };
}
