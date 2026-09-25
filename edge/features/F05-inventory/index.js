// F05 · Spare-parts inventory tracking
// AC-F05-1..5 — see spec edge/features/F05-inventory/index.js
// No I/O, no network, no npm deps (ADR-002).

export function createInventory(parts = []) {
  const stock = new Map(); // sku -> { onHand, reserved, reorderPoint, reorderQty }
  const reservationsMap = new Map(); // ref -> { sku, qty }
  const requisitionsMap = new Map(); // id -> { id, sku, qty, status }
  let reqCounter = 0;

  for (const p of parts) {
    stock.set(p.sku, {
      onHand: p.onHand,
      reserved: 0,
      reorderPoint: p.reorderPoint,
      reorderQty: p.reorderQty ?? p.reorderPoint,
    });
  }

  function assertKnownSku(sku) {
    if (!stock.has(sku)) {
      throw new Error('unknown sku: ' + sku);
    }
  }

  function available(sku) {
    assertKnownSku(sku);
    const s = stock.get(sku);
    return s.onHand - s.reserved;
  }

  function hasOpenRequisition(sku) {
    for (const r of requisitionsMap.values()) {
      if (r.sku === sku && r.status === 'open') return true;
    }
    return false;
  }

  // AC-F05-3: exactly one open requisition per SKU once available <= reorderPoint
  function maybeRequisition(sku) {
    const s = stock.get(sku);
    const avail = s.onHand - s.reserved;
    if (avail <= s.reorderPoint && !hasOpenRequisition(sku)) {
      const qty = Math.max(s.reorderQty ?? 1, s.reorderPoint - avail, 1);
      reqCounter += 1;
      const id = 'REQ-' + reqCounter;
      requisitionsMap.set(id, { id, sku, qty, status: 'open' });
    }
  }

  // AC-F05-1: reservations never drive availability negative; shortfall reported
  function reserve(sku, qty, ref) {
    assertKnownSku(sku);
    if (!Number.isFinite(qty)) throw new Error('invalid qty');
    const avail = available(sku);
    const shortfall = Math.max(0, qty - avail);
    const grant = qty - shortfall;
    const s = stock.get(sku);
    s.reserved += grant;
    reservationsMap.set(ref, { sku, qty: grant });
    maybeRequisition(sku);
    return { ok: shortfall === 0, reserved: grant, shortfall };
  }

  // AC-F05-2: release returns stock
  function release(ref) {
    const r = reservationsMap.get(ref);
    if (!r) return;
    const s = stock.get(r.sku);
    s.reserved -= r.qty;
    reservationsMap.delete(ref);
  }

  // AC-F05-2: consume reduces on-hand and clears reservation
  function consume(ref) {
    const r = reservationsMap.get(ref);
    if (!r) return;
    const s = stock.get(r.sku);
    s.onHand -= r.qty;
    s.reserved -= r.qty;
    reservationsMap.delete(ref);
    maybeRequisition(r.sku);
  }

  // AC-F05-4: receiving a requisition restocks by its quantity and closes it
  function receive(reqId) {
    const r = requisitionsMap.get(reqId);
    if (!r || r.status !== 'open') return false;
    const s = stock.get(r.sku);
    s.onHand += r.qty;
    r.status = 'received';
    return true;
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
