// F05 · Spare-parts inventory tracking
// edge/features/F05-inventory/index.js
//
// Pure, in-memory inventory tracker: no I/O, no network, no OT writes — read-only
// toward OT per org security standard (IEC 62443 zones/conduits — this module has
// zero OT dependency, it only tracks stock levels in memory). Data handled here
// (SKU, quantities, WO refs) is C1 Internal; no operator/technician identity is
// ever accepted or stored (org privacy standard). All quantities are validated as
// finite numbers per the IoT "untrusted input" standard applied as general input
// hygiene.
//
// AC-F05-1: reserve() never lets reserved exceed onHand; shortfall is reported.
// AC-F05-2: release() returns stock; consume() reduces on-hand and clears the reservation.
// AC-F05-3: exactly one open requisition per SKU once available <= reorderPoint.
// AC-F05-4: receive() restocks by the requisition's qty and closes it.
// AC-F05-5: unknown SKUs/refs/requisition ids throw.

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

export function createInventory(parts = []) {
  const catalog = new Map(); // sku -> { onHand, reserved, reorderPoint, reorderQty }
  const reservationsMap = new Map(); // ref -> { sku, qty }
  const requisitionsMap = new Map(); // id -> { id, sku, qty, status }
  const openReqBySku = new Map(); // sku -> id
  let nextReqId = 1;

  for (const p of parts) {
    if (!p || typeof p.sku !== 'string') continue;
    catalog.set(p.sku, {
      onHand: isFiniteNumber(p.onHand) ? p.onHand : 0,
      reserved: 0,
      reorderPoint: isFiniteNumber(p.reorderPoint) ? p.reorderPoint : 0,
      reorderQty: isFiniteNumber(p.reorderQty) ? p.reorderQty : 0,
    });
  }

  function assertKnownSku(sku) {
    if (!catalog.has(sku)) {
      throw new Error(`F05-inventory: unknown SKU "${sku}"`);
    }
    return catalog.get(sku);
  }

  function assertKnownRef(ref) {
    if (!reservationsMap.has(ref)) {
      throw new Error(`F05-inventory: unknown reservation ref "${ref}"`);
    }
    return reservationsMap.get(ref);
  }

  function assertKnownReq(reqId) {
    if (!requisitionsMap.has(reqId)) {
      throw new Error(`F05-inventory: unknown requisition id "${reqId}"`);
    }
    return requisitionsMap.get(reqId);
  }

  function availableOf(sku) {
    const entry = catalog.get(sku);
    return entry.onHand - entry.reserved;
  }

  function maybeRequisition(sku) {
    const entry = catalog.get(sku);
    if (availableOf(sku) <= entry.reorderPoint && !openReqBySku.has(sku)) {
      const id = nextReqId++;
      const req = { id, sku, qty: entry.reorderQty, status: 'open' };
      requisitionsMap.set(id, req);
      openReqBySku.set(sku, id);
    }
  }

  function reserve(sku, qty, ref) {
    const entry = assertKnownSku(sku);
    if (!isFiniteNumber(qty) || qty < 0) {
      throw new Error('F05-inventory: qty must be a finite non-negative number');
    }
    const avail = availableOf(sku);
    const reservedQty = Math.min(qty, avail);
    const shortfall = qty - reservedQty;

    if (reservedQty > 0) {
      entry.reserved += reservedQty;
      const existing = reservationsMap.get(ref);
      if (existing && existing.sku === sku) {
        existing.qty += reservedQty;
      } else {
        reservationsMap.set(ref, { sku, qty: reservedQty });
      }
    }

    maybeRequisition(sku);

    return { ok: shortfall === 0, reserved: reservedQty, shortfall };
  }

  function release(ref) {
    const res = assertKnownRef(ref);
    const entry = catalog.get(res.sku);
    entry.reserved -= res.qty;
    reservationsMap.delete(ref);
  }

  function consume(ref) {
    const res = assertKnownRef(ref);
    const entry = catalog.get(res.sku);
    entry.onHand -= res.qty;
    entry.reserved -= res.qty;
    reservationsMap.delete(ref);
    maybeRequisition(res.sku);
  }

  function receive(reqId) {
    const req = assertKnownReq(reqId);
    const entry = catalog.get(req.sku);
    entry.onHand += req.qty;
    req.status = 'received';
    if (openReqBySku.get(req.sku) === reqId) {
      openReqBySku.delete(req.sku);
    }
    return true;
  }

  function available(sku) {
    assertKnownSku(sku);
    return availableOf(sku);
  }

  function list() {
    return Array.from(catalog.entries()).map(([sku, entry]) => ({
      sku,
      onHand: entry.onHand,
      reserved: entry.reserved,
      available: entry.onHand - entry.reserved,
    }));
  }

  function lowStock() {
    return Array.from(catalog.entries())
      .filter(([, entry]) => entry.onHand - entry.reserved <= entry.reorderPoint)
      .map(([sku, entry]) => ({
        sku,
        available: entry.onHand - entry.reserved,
        reorderPoint: entry.reorderPoint,
      }));
  }

  function requisitions() {
    return Array.from(requisitionsMap.values()).map((r) => ({ ...r }));
  }

  function reservationsList() {
    return Array.from(reservationsMap.entries()).map(([ref, r]) => ({
      ref,
      sku: r.sku,
      qty: r.qty,
    }));
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
