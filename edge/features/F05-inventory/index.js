// F05 · Spare-parts inventory tracking
// Pure ES module, no I/O, no network, no eval. Read-only toward OT (IEC 62443 posture, ADR-001).
// Data classification: C1 Internal (part catalogue + stock levels); no PII, no telemetry.
// Input validation treats all inputs as untrusted (org IoT security standard): skus, refs,
// reqIds and qty are strictly validated and never silently coerced.

function isPositiveFinite(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function isNonEmptyString(s) {
  return typeof s === 'string' && s.length > 0;
}

export function createInventory(parts = []) {
  const partMap = new Map(); // sku -> { onHand, reserved, reorderPoint }
  const reservations = new Map(); // ref -> { sku, qty }
  const requisitions = new Map(); // reqId -> { reqId, sku, qty, open }
  let reqSeq = 0;

  for (const p of parts) {
    partMap.set(p.sku, {
      onHand: p.onHand,
      reserved: 0,
      reorderPoint: p.reorderPoint,
      reorderQty: p.reorderQty ?? p.reorderPoint ?? 0,
    });
  }

  function assertKnownSku(sku) {
    if (!partMap.has(sku)) {
      throw new Error(`F05: unknown sku '${sku}'`);
    }
    return partMap.get(sku);
  }

  function availableOf(sku) {
    const p = assertKnownSku(sku);
    return p.onHand - p.reserved;
  }

  function nextReqId() {
    reqSeq += 1;
    return `REQ-${reqSeq}`;
  }

  function maybeRequisition(sku) {
    const p = partMap.get(sku);
    if (availableOf(sku) <= p.reorderPoint) {
      const hasOpen = [...requisitions.values()].some(r => r.sku === sku && r.open);
      if (!hasOpen) {
        const reqId = nextReqId();
        requisitions.set(reqId, {
          reqId,
          sku,
          qty: p.reorderQty,
          open: true,
        });
      }
    }
  }

  return {
    reserve(sku, qty, ref) {
      const p = assertKnownSku(sku);
      if (!isPositiveFinite(qty)) {
        throw new Error('F05: qty must be a finite positive number');
      }
      if (!isNonEmptyString(ref)) {
        throw new Error('F05: ref must be a non-empty string');
      }
      const available = availableOf(sku);
      const reserved = Math.max(0, Math.min(qty, available));
      const shortfall = qty - reserved;
      if (reserved > 0) {
        p.reserved += reserved;
        const existing = reservations.get(ref);
        if (existing) {
          existing.qty += reserved;
        } else {
          reservations.set(ref, { sku, qty: reserved });
        }
      }
      maybeRequisition(sku);
      return { ok: shortfall === 0, reserved, shortfall };
    },

    release(ref) {
      if (!isNonEmptyString(ref) || !reservations.has(ref)) {
        throw new Error(`F05: unknown reservation ref '${ref}'`);
      }
      const { sku, qty } = reservations.get(ref);
      const p = assertKnownSku(sku);
      p.reserved -= qty;
      reservations.delete(ref);
    },

    consume(ref) {
      if (!isNonEmptyString(ref) || !reservations.has(ref)) {
        throw new Error(`F05: unknown reservation ref '${ref}'`);
      }
      const { sku, qty } = reservations.get(ref);
      const p = assertKnownSku(sku);
      p.onHand -= qty;
      p.reserved -= qty;
      reservations.delete(ref);
      maybeRequisition(sku);
    },

    receive(reqId) {
      if (!isNonEmptyString(reqId) || !requisitions.has(reqId)) {
        throw new Error(`F05: unknown requisition '${reqId}'`);
      }
      const req = requisitions.get(reqId);
      if (!req.open) {
        throw new Error(`F05: requisition '${reqId}' already closed`);
      }
      const p = assertKnownSku(req.sku);
      p.onHand += req.qty;
      req.open = false;
      return true;
    },

    available(sku) {
      return availableOf(sku);
    },

    list() {
      return [...partMap.entries()].map(([sku, p]) => ({
        sku,
        onHand: p.onHand,
        reserved: p.reserved,
        available: p.onHand - p.reserved,
      }));
    },

    lowStock() {
      return [...partMap.entries()]
        .filter(([sku, p]) => (p.onHand - p.reserved) <= p.reorderPoint)
        .map(([sku, p]) => ({
          sku,
          available: p.onHand - p.reserved,
          reorderPoint: p.reorderPoint,
        }));
    },

    requisitions() {
      return [...requisitions.values()].map(r => ({
        id: r.reqId,
        reqId: r.reqId,
        sku: r.sku,
        qty: r.qty,
        status: r.open ? 'open' : 'received',
        open: r.open,
      }));
    },

    reservations() {
      return [...reservations.entries()].map(([ref, r]) => ({
        ref,
        sku: r.sku,
        qty: r.qty,
      }));
    },
  };
}
