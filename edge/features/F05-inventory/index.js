// edge/features/F05-inventory/index.js
// F05 · Spare-parts inventory tracking
// No third-party deps; pure computation; no network/process.env/eval.

function assertFiniteNumber(n, label) {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`invalid ${label}: ${n}`);
  }
}

export function createInventory(parts = []) {
  const stock = new Map(); // sku -> { onHand, reserved, reorderPoint }
  const reservationsMap = new Map(); // ref -> { sku, qty }
  const requisitionsMap = new Map(); // reqId -> { sku, qty, open: true }
  let reqCounter = 0;

  // AC-F05-5: unknown skus throw. Every sku-accepting method calls this guard.
  function assertKnownSku(sku) {
    if (!stock.has(sku)) {
      throw new Error('unknown sku: ' + sku);
    }
  }

  function hasOpenRequisition(sku) {
    for (const req of requisitionsMap.values()) {
      if (req.open && req.sku === sku) return true;
    }
    return false;
  }

  // AC-F05-3: exactly one open requisition per SKU once available <= reorder point.
  function maybeRequisition(sku) {
    const s = stock.get(sku);
    const avail = s.onHand - s.reserved;
    if (avail <= s.reorderPoint && !hasOpenRequisition(sku)) {
      const qty = Math.max(1, s.reorderPoint - avail);
      const id = `PR-${String(++reqCounter).padStart(4, '0')}`;
      requisitionsMap.set(id, { sku, qty, open: true });
    }
  }

  for (const p of parts) {
    assertFiniteNumber(p.onHand, 'onHand');
    assertFiniteNumber(p.reorderPoint, 'reorderPoint');
    stock.set(p.sku, {
      onHand: p.onHand,
      reserved: 0,
      reorderPoint: p.reorderPoint,
    });
  }

  // Seed requisitions for any SKU that starts at/below its reorder point,
  // so AC-F05-3's "exactly one open requisition per SKU" holds immediately
  // after construction, not only after the first reserve()/consume() call.
  for (const sku of stock.keys()) {
    maybeRequisition(sku);
  }

  function available(sku) {
    assertKnownSku(sku);
    const s = stock.get(sku);
    return s.onHand - s.reserved;
  }

  // AC-F05-1: reservations never drive availability negative; shortfall is reported.
  function reserve(sku, qty, ref) {
    assertKnownSku(sku);
    assertFiniteNumber(qty, 'qty');
    if (qty < 0) throw new Error('invalid qty: ' + qty);
    const s = stock.get(sku);
    const avail = s.onHand - s.reserved;
    const reservedQty = Math.min(qty, Math.max(0, avail));
    const shortfall = qty - reservedQty;
    s.reserved += reservedQty;
    if (reservedQty > 0) {
      reservationsMap.set(ref, { sku, qty: reservedQty });
    }
    maybeRequisition(sku);
    return { ok: shortfall === 0, reserved: reservedQty, shortfall };
  }

  // AC-F05-2: release returns stock (decrements reserved only).
  function release(ref) {
    const r = reservationsMap.get(ref);
    if (!r) return;
    const s = stock.get(r.sku);
    if (s) {
      s.reserved -= r.qty;
      if (s.reserved < 0) s.reserved = 0;
    }
    reservationsMap.delete(ref);
  }

  // AC-F05-2: consume reduces on-hand and clears reservation.
  function consume(ref) {
    const r = reservationsMap.get(ref);
    if (!r) return;
    const s = stock.get(r.sku);
    if (s) {
      s.onHand -= r.qty;
      s.reserved -= r.qty;
      if (s.reserved < 0) s.reserved = 0;
    }
    reservationsMap.delete(ref);
    if (s) maybeRequisition(r.sku);
  }

  // AC-F05-4: receiving a requisition restocks by its quantity and closes it.
  function receive(reqId) {
    const req = requisitionsMap.get(reqId);
    if (!req || !req.open) return;
    assertKnownSku(req.sku);
    const s = stock.get(req.sku);
    s.onHand += req.qty;
    req.open = false;
    requisitionsMap.delete(reqId);
  }

  function list() {
    return Array.from(stock.entries()).map(([sku, s]) => ({
      sku,
      onHand: s.onHand,
      reserved: s.reserved,
      available: s.onHand - s.reserved,
    }));
  }

  function lowStock() {
    const result = [];
    for (const [sku, s] of stock.entries()) {
      if (s.onHand - s.reserved <= s.reorderPoint) result.push(sku);
    }
    return result;
  }

  function requisitions() {
    return Array.from(requisitionsMap.entries())
      .filter(([, req]) => req.open)
      .map(([id, req]) => ({ id, sku: req.sku, qty: req.qty }));
  }

  function reservations() {
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
    reservations,
  };
}
