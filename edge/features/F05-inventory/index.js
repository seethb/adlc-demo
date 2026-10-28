// F05 · Spare-parts inventory tracking
// Pure in-memory ES module — no I/O, no network, no process.env, no eval.
// Edge analytics is read-only toward OT (IEC 62443 zones/conduits): this module
// never writes to PLCs/controllers; it only reflects WO-driven consumption
// supplied by the caller (org security-standard).
// Telemetry/inputs are treated as untrusted: qty must be a finite positive
// number and sku/ref/reqId must be known, otherwise we throw (IoT security
// standard — reject non-finite / unknown identifiers).

export function createInventory(parts = []) {
  const stock = new Map(); // sku -> { onHand, reserved, reorderPoint, reorderQty }
  const reservationsMap = new Map(); // ref -> { sku, qty }
  const requisitionsMap = new Map(); // id -> { sku, qty, status }
  let reqSeq = 1;

  for (const p of parts) {
    stock.set(p.sku, {
      onHand: p.onHand,
      reserved: 0,
      reorderPoint: p.reorderPoint,
      reorderQty: p.reorderQty,
    });
  }

  // AC-F05-5: unknown SKUs throw
  function assertKnownSku(sku) {
    if (!stock.has(sku)) throw new Error(`unknown SKU: ${sku}`);
  }

  function assertFinitePositive(n, label) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
      throw new Error(`invalid ${label}: ${n}`);
    }
  }

  function availableQty(sku) {
    const s = stock.get(sku);
    return s.onHand - s.reserved;
  }

  // AC-F05-3: exactly one open requisition per SKU once available <= reorder point
  function maybeRequisition(sku) {
    const s = stock.get(sku);
    if (availableQty(sku) > s.reorderPoint) return;
    for (const req of requisitionsMap.values()) {
      if (req.sku === sku && req.status === 'open') return; // already open
    }
    const id = `REQ-${reqSeq++}`;
    requisitionsMap.set(id, { id, sku, qty: s.reorderQty, status: 'open' });
  }

  function closeRequisition(reqId, status) {
    const req = requisitionsMap.get(reqId);
    if (!req) throw new Error(`unknown requisition: ${reqId}`);
    req.status = status;
  }

  function reserve(sku, qty, ref) {
    assertKnownSku(sku);
    assertFinitePositive(qty, 'qty');
    const s = stock.get(sku);
    const avail = availableQty(sku);
    const reserved = Math.min(qty, avail);
    const shortfall = qty - reserved;
    if (reserved > 0) {
      s.reserved += reserved;
      const existing = reservationsMap.get(ref);
      if (existing) {
        if (existing.sku !== sku) throw new Error(`ref already used for another SKU: ${ref}`);
        existing.qty += reserved;
      } else {
        reservationsMap.set(ref, { sku, qty: reserved });
      }
    }
    // AC-F05-1: never drive availability negative; report shortfall
    maybeRequisition(sku);
    return { ok: shortfall === 0, reserved, shortfall };
  }

  // AC-F05-2: release returns stock
  function release(ref) {
    const r = reservationsMap.get(ref);
    if (!r) throw new Error(`unknown reservation ref: ${ref}`);
    const s = stock.get(r.sku);
    s.reserved -= r.qty;
    reservationsMap.delete(ref);
  }

  // AC-F05-2: consume reduces on-hand and clears the reservation
  function consume(ref) {
    const r = reservationsMap.get(ref);
    if (!r) throw new Error(`unknown reservation ref: ${ref}`);
    const s = stock.get(r.sku);
    s.onHand -= r.qty;
    s.reserved -= r.qty;
    reservationsMap.delete(ref);
    maybeRequisition(r.sku);
  }

  // AC-F05-4: receiving a requisition restocks by its quantity and closes it
  function receive(reqId) {
    const req = requisitionsMap.get(reqId);
    if (!req) throw new Error(`unknown requisition: ${reqId}`);
    if (req.status !== 'open') return false;
    const s = stock.get(req.sku);
    s.onHand += req.qty;
    closeRequisition(reqId, 'received');
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
    return list().filter((i) => i.available <= stock.get(i.sku).reorderPoint);
  }

  function requisitions() {
    return [...requisitionsMap.values()].map((r) => ({ ...r }));
  }

  function reservations() {
    return [...reservationsMap.entries()].map(([ref, r]) => ({ ref, sku: r.sku, qty: r.qty }));
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
    reservations,
  };
}
