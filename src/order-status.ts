import type { G2GNormalizedOrderState } from "./types.js";

type Fields = Record<string, unknown>;

export const OPEN_DELIVERY_STATES = new Set<string>([
  "paid",
  "preparing",
  "to_deliver",
  "start_deliver",
  "new_order",
  "processing",
  "delivering",
  "delivering_in_progress",
]);

export const FINISHED_DELIVERY_STATES = new Set<string>([
  "delivered",
  "completed",
  "received",
  "awaiting_buyer_confirmation",
]);

function asFields(value: unknown): Fields {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Fields) : {};
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Classify a raw G2G order or webhook payload into a safe normalized state.
 *
 * Rules:
 * - Any cancellation, refund, dispute, chargeback, void signal, or positive
 *   `refunded_qty` / `cancelled_qty` always resolves to `"cancelled"`.
 * - Any finished state resolves to `"delivered"`.
 * - An order is only considered open/deliverable when BOTH the order status is
 *   in `OPEN_DELIVERY_STATES` AND `payment_status === "paid"`.
 * - Anything missing payment verification resolves to `"unverified"`.
 */
export function classifyG2GOrderState(payload: unknown, eventType = ""): G2GNormalizedOrderState {
  const outer = asFields(payload);
  const inner = asFields(outer.payload ?? outer.data ?? outer);
  const snapshots = inner === outer ? [inner] : [inner, outer];

  const orderStates = snapshots
    .flatMap((row) => [row.order_item_status, row.order_status, row.status])
    .map(normalize)
    .filter(Boolean);

  const payments = snapshots.map((row) => normalize(row.payment_status)).filter(Boolean);
  const signals = [
    ...orderStates,
    ...payments,
    normalize(eventType),
    normalize(outer.event),
    normalize(outer.event_type),
    normalize(outer.type),
  ];

  if (
    signals.some((value) => /cancel|refund|revers|chargeback|dispute|void/.test(value)) ||
    snapshots.some((row) =>
      [row.refunded_qty, row.cancelled_qty, row.canceled_qty].some((qty) => Number(qty) > 0)
    )
  ) {
    return "cancelled";
  }

  if (orderStates.some((value) => FINISHED_DELIVERY_STATES.has(value))) {
    return "delivered";
  }

  if (
    !orderStates.length ||
    !orderStates.every((value) => OPEN_DELIVERY_STATES.has(value)) ||
    !payments.length ||
    !payments.every((value) => value === "paid")
  ) {
    return "unverified";
  }

  return orderStates[0] as G2GNormalizedOrderState;
}

/**
 * Return `true` only if the G2G order payload is verified paid and still open for delivery.
 */
export function allowsG2GDelivery(payload: unknown, eventType = ""): boolean {
  return OPEN_DELIVERY_STATES.has(classifyG2GOrderState(payload, eventType));
}

/**
 * Return `true` if an order timestamp (seconds or milliseconds) falls within `maxAgeMs` (default 12h).
 */
export function isRecentG2GOrder(
  createdAt: unknown,
  nowMs = Date.now(),
  maxAgeMs = 12 * 60 * 60 * 1000
): boolean {
  const timestamp = Number(createdAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  const epochMs = timestamp > 1e12 ? timestamp : timestamp * 1000;
  const age = nowMs - epochMs;
  return age >= 0 && age < maxAgeMs;
}
