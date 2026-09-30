// F05 · Spare-parts inventory tracking
// Pure ES module, no I/O, no deps. See specs/features/F05-inventory/design.md.
// CR-002: adds low-stock notifications (AC-CR002-1) without altering prior
// behaviour (AC-CR002-2, regression of AC-F05-1..5).

function isPositiveInt(n) {
  return Number.isFinite(n) && Number.isInteger(n) && n > 0;
}

// CR-002: fixed threshold, independent of per-SKU reorderPoint (team decision).
const LOW_STOCK_THRESHOLD = 5;

function isLowStock(avail) {
  return avail < LOW_STOCK_THRESHOLD;
}

export function createInventory(parts = []) {
  const stock = new Map(); // sku -> { onHand, reserved, reorderPoint, reorderQty }
  const reservationsMap = new Map(); // ref -> { sku, qty }
  const requisitionsMap = new Map(); // id -> { sku, qty, status }
  let reqCounter = 0;

  for (const p of parts) {
    stock.set(p.sku, {
      onHand: p.onHand ?? 0,
      reserved: 0,
      reorderPoint: p.reorderPoint ?? 0,
      // AC-F05-3/4: fallback reorderQty; if reorderPoint is 0 (and no reorderQty given)
      // maybeRequisition still floors the request qty at 1, so a qty=0 requisition
      // can never be created even with this fallback.
      reorderQty: p.reorderQty ?? Math.max(1, p.reorderPoint ?? 1),
    });
  }

  function assertKnownSku(sku) {
    if (!stock.has(sku)) throw new Error('unknown sku: ' + sku);
  }

  function available(sku) {
    assertKnownSku(sku);
    const s = stock.get(sku);
    return s.onHand - s.reserved;
  }

  function maybeRequisition(sku) {
    const s = stock.get(sku);
    const avail = s.onHand - s.reserved;
    if (avail <= s.reorderPoint) {
      const hasOpen = [...requisitionsMap.values()].some(
        (r) => r.sku === sku && r.status === 'open'
      );
      if (!hasOpen) {
        const qty = Math.max(s.reorderPoint - avail, s.reorderQty, 1);
        const id = 'REQ-' + ++reqCounter;
        requisitionsMap.set(id, { id, sku, qty, status: 'open' });
      }
    }
  }

  function reserve(sku, qty, ref) {
    assertKnownSku(sku);
    if (!isPositiveInt(qty)) {
      throw new Error('invalid qty: ' + qty);
    }
    if (typeof ref !== 'string' || ref.length === 0) {
      throw new Error('invalid ref: ' + ref);
    }
    // AC-F05-1: reservation ref must be a stable, unique identity. If the same
    // ref is reused while still open, release the prior reservation's stock
    // first to avoid leaking reserved quantity on the old sku.
    if (reservationsMap.has(ref)) {
      release(ref);
    }
    const s = stock.get(sku);
    const avail = s.onHand - s.reserved;
    const shortfall = Math.max(0, qty - avail);
    const granted = qty - shortfall;
    s.reserved += granted;
    reservationsMap.set(ref, { sku, qty: granted });
    maybeRequisition(sku);
    return { ok: shortfall === 0, reserved: granted, shortfall };
  }

  function release(ref) {
    const r = reservationsMap.get(ref);
    if (!r) return;
    const s = stock.get(r.sku);
    if (s) s.reserved -= r.qty;
    reservationsMap.delete(ref);
  }

  function consume(ref) {
    const r = reservationsMap.get(ref);
    if (!r) return;
    const s = stock.get(r.sku);
    if (s) {
      s.onHand -= r.qty;
      s.reserved -= r.qty;
    }
    reservationsMap.delete(ref);
    if (s) maybeRequisition(r.sku);
  }

  function receive(reqId) {
    const req = requisitionsMap.get(reqId);
    if (!req || req.status !== 'open') return false;
    const s = stock.get(req.sku);
    if (s) s.onHand += req.qty;
    req.status = 'received';
    return true;
  }

  function list() {
    // AC-CR002-1: each item carries a `notify` flag computed on every view,
    // no caching, no side effects. Threshold is fixed (LOW_STOCK_THRESHOLD),
    // decoupled from reorderPoint.
    return [...stock.entries()].map(([sku, s]) => {
      const avail = s.onHand - s.reserved;
      return {
        sku,
        onHand: s.onHand,
        reserved: s.reserved,
        available: avail,
        notify: isLowStock(avail),
      };
    });
  }

  function lowStock() {
    return list().filter((i) => i.available <= stock.get(i.sku).reorderPoint);
  }

  // AC-CR002-1: derived read of all SKUs currently below the fixed low-stock
  // threshold; no stored state, recomputed on every call.
  function notifications() {
    const out = [];
    for (const [sku, s] of stock.entries()) {
      const avail = s.onHand - s.reserved;
      if (isLowStock(avail)) {
        out.push({
          sku,
          available: avail,
          message: `Low stock: SKU ${sku} has ${avail} available`,
        });
      }
    }
    return out;
  }

  function requisitions() {
    return [...requisitionsMap.values()].map((r) => ({ ...r }));
  }

  function reservations() {
    return [...reservationsMap.entries()].map(([ref, r]) => ({ ref, ...r }));
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
    notifications,
  };
}
