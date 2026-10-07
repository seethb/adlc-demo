// F05 · Spare-parts inventory tracking
// Pure ES module, no I/O, no deps. See specs/features/F05-inventory/design.md.
// CR-001: long-lead parts (leadTimeDays >= 14) are critical spares — they reorder
// one unit early (available <= reorderPoint + 1) and requisitions carry
// priority/etaDays/reason. See specs/changes/CR-001-f05-expedite-long-lead/design.md.

function isPositiveInt(n) {
  return Number.isFinite(n) && Number.isInteger(n) && n > 0;
}

export function createInventory(parts = []) {
  const stock = new Map(); // sku -> { onHand, reserved, reorderPoint, reorderQty, leadTimeDays, name }
  const reservationsMap = new Map(); // ref -> { sku, qty }
  const requisitionsMap = new Map(); // id -> { id, sku, qty, status, priority, etaDays, reason }
  let reqCounter = 0;

  for (const p of parts) {
    stock.set(p.sku, {
      name: p.name ?? p.sku,
      onHand: p.onHand ?? 0,
      reserved: 0,
      reorderPoint: p.reorderPoint ?? 0,
      // AC-F05-3/4: fallback reorderQty; if reorderPoint is 0 (and no reorderQty given)
      // maybeRequisition still floors the request qty at 1, so a qty=0 requisition
      // can never be created even with this fallback.
      reorderQty: p.reorderQty ?? Math.max(1, p.reorderPoint ?? 1),
      leadTimeDays: p.leadTimeDays ?? 0,
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

  // AC-CR001-1: long-lead parts (leadTimeDays >= 14) are critical spares.
  function isLongLead(s) {
    return s.leadTimeDays >= 14;
  }

  // AC-CR001-1/AC-CR001-4: shared threshold used both for reorder trigger and `low`.
  function threshold(s) {
    return s.reorderPoint + (isLongLead(s) ? 1 : 0);
  }

  function maybeRequisition(sku) {
    const s = stock.get(sku);
    const avail = s.onHand - s.reserved;
    if (avail <= threshold(s)) {
      const hasOpen = [...requisitionsMap.values()].some(
        (r) => r.sku === sku && r.status === 'open'
      );
      if (!hasOpen) {
        const qty = Math.max(s.reorderPoint - avail, s.reorderQty, 1);
        const id = 'REQ-' + ++reqCounter;
        const longLead = isLongLead(s);
        requisitionsMap.set(id, {
          id,
          sku,
          qty,
          status: 'open',
          // AC-CR001-2: priority/etaDays/reason vary by lead-time class.
          priority: longLead ? 'expedite' : 'normal',
          etaDays: longLead ? Math.ceil(s.leadTimeDays / 2) : s.leadTimeDays,
          reason: longLead ? 'critical-spare-early-reorder' : 'reorder-point',
        });
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

  // AC-CR001-4: list() surfaces part-master fields for the edge UI, with `low`
  // computed from the same threshold used to trigger requisitions (AC-CR001-1).
  function list() {
    return [...stock.entries()].map(([sku, s]) => {
      const avail = s.onHand - s.reserved;
      return {
        sku,
        name: s.name,
        onHand: s.onHand,
        reserved: s.reserved,
        available: avail,
        reorderPoint: s.reorderPoint,
        leadTimeDays: s.leadTimeDays,
        low: avail <= threshold(s),
      };
    });
  }

  function lowStock() {
    return list().filter((i) => i.low);
  }

  function requisitions() {
    return [...requisitionsMap.values()].map((r) => ({ ...r }));
  }

  function reservations() {
    return [...reservationsMap.entries()].map(([ref, r]) => ({ ref, ...r }));
  }

  // AC-CR001-3: parts already at/below their threshold get an open requisition
  // immediately on creation, before any reserve/consume call.
  for (const sku of stock.keys()) {
    maybeRequisition(sku);
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
