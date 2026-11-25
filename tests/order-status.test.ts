import assert from "node:assert/strict";
import test from "node:test";
import { allowsG2GDelivery, classifyG2GOrderState, isRecentG2GOrder } from "../src/order-status.js";

test("classifyG2GOrderState allows verified paid open orders", () => {
  const payload = {
    payload: {
      order_id: "1730000001",
      order_status: "to_deliver",
      payment_status: "paid",
    },
  };
  assert.equal(classifyG2GOrderState(payload), "to_deliver");
  assert.equal(allowsG2GDelivery(payload), true);
});

test("classifyG2GOrderState blocks cancelled, refunded, or unpaid orders", () => {
  assert.equal(
    classifyG2GOrderState({
      order_status: "paid",
      payment_status: "paid",
      refunded_qty: 1,
    }),
    "cancelled"
  );
  assert.equal(
    allowsG2GDelivery({ order_status: "to_deliver", payment_status: "pending" }),
    false
  );
  assert.equal(
    classifyG2GOrderState({ order_status: "delivered", payment_status: "paid" }),
    "delivered"
  );
});

test("isRecentG2GOrder accepts both Unix seconds and milliseconds", () => {
  const now = 1_730_000_000_000;
  assert.equal(isRecentG2GOrder(Math.floor((now - 60_000) / 1000), now), true);
  assert.equal(isRecentG2GOrder(now - 60_000, now), true);
  assert.equal(isRecentG2GOrder(now - 24 * 60 * 60 * 1000, now), false);
});
