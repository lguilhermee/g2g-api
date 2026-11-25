import assert from "node:assert/strict";
import test from "node:test";
import { signG2GWebhook, verifyG2GWebhookSignature } from "../src/webhook.js";

test("verifyG2GWebhookSignature accepts valid HMAC-SHA256 within 5-minute window", () => {
  const now = 1_730_000_000_000;
  const webhookUrl = "https://example.com/api/v0.1/webhook";
  const userId = "123456";
  const webhookSecret = "whsec_demo_secret";
  const timestamp = String(now - 10_000);

  const signature = signG2GWebhook({ webhookUrl, userId, timestamp, webhookSecret });

  assert.equal(
    verifyG2GWebhookSignature(
      { webhookUrl, userId, timestamp, signatureHeader: signature, webhookSecret },
      now
    ),
    true
  );
});

test("verifyG2GWebhookSignature rejects expired timestamps and forged signatures", () => {
  const now = 1_730_000_000_000;
  const webhookUrl = "https://example.com/api/v0.1/webhook";
  const userId = "123456";
  const webhookSecret = "whsec_demo_secret";

  const staleTs = String(now - 6 * 60_000);
  const staleSig = signG2GWebhook({ webhookUrl, userId, timestamp: staleTs, webhookSecret });
  assert.equal(
    verifyG2GWebhookSignature(
      { webhookUrl, userId, timestamp: staleTs, signatureHeader: staleSig, webhookSecret },
      now
    ),
    false
  );

  const freshTs = String(now);
  assert.equal(
    verifyG2GWebhookSignature(
      {
        webhookUrl,
        userId,
        timestamp: freshTs,
        signatureHeader: "0".repeat(64),
        webhookSecret,
      },
      now
    ),
    false
  );
});
