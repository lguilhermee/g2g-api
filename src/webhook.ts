import crypto from "node:crypto";
import type { RequestHandler } from "express";
import type { G2GWebhookVerifyParams } from "./types.js";

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Compute a G2G webhook HMAC-SHA256 signature for testing or verification.
 *
 * Canonical string:
 *   `canonical = webhookUrl + userId + timestamp`
 */
export function signG2GWebhook(params: {
  webhookUrl: string;
  userId: string;
  timestamp: string;
  webhookSecret: string;
}): string {
  return crypto
    .createHmac("sha256", params.webhookSecret)
    .update(`${params.webhookUrl}${params.userId}${params.timestamp}`)
    .digest("hex");
}

/**
 * Verify an inbound G2G webhook request signature using constant-time comparison
 * and a replay-protection timestamp window (default ±5 minutes).
 */
export function verifyG2GWebhookSignature(
  params: G2GWebhookVerifyParams,
  nowMs = Date.now()
): boolean {
  const maxAgeMs = params.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!params.webhookSecret || !params.userId || !params.webhookUrl) {
    return false;
  }
  if (!/^\d{13}$/.test(params.timestamp) || Math.abs(nowMs - Number(params.timestamp)) > maxAgeMs) {
    return false;
  }
  if (!/^[a-f0-9]{64}$/i.test(params.signatureHeader)) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", params.webhookSecret)
    .update(`${params.webhookUrl}${params.userId}${params.timestamp}`)
    .digest();

  return crypto.timingSafeEqual(expected, Buffer.from(params.signatureHeader, "hex"));
}

export interface G2GWebhookMiddlewareOptions {
  /** Exact public callback URL registered in your G2G Seller OpenAPI dashboard. */
  webhookUrl: string;
  /** Your numeric G2G user ID. */
  userId: string;
  /** Webhook signing secret from G2G Seller OpenAPI dashboard. */
  webhookSecret: string;
  /** Optional replay window in ms (default 5 minutes). */
  maxAgeMs?: number;
}

/**
 * Express middleware that rejects unverified or replayed G2G webhooks with HTTP 401/503.
 */
export function createG2GWebhookMiddleware(
  options: G2GWebhookMiddlewareOptions | (() => Promise<G2GWebhookMiddlewareOptions | null>)
): RequestHandler {
  return async (req, res, next) => {
    let resolved: G2GWebhookMiddlewareOptions | null = null;
    try {
      resolved = typeof options === "function" ? await options() : options;
    } catch {
      resolved = null;
    }

    if (!resolved?.webhookSecret || !resolved?.userId || !resolved?.webhookUrl) {
      res.status(503).json({ error: "G2G webhook verification is not configured" });
      return;
    }

    const ok = verifyG2GWebhookSignature({
      webhookUrl: resolved.webhookUrl,
      userId: resolved.userId,
      webhookSecret: resolved.webhookSecret,
      maxAgeMs: resolved.maxAgeMs,
      timestamp: req.header("g2g-timestamp") || "",
      signatureHeader: req.header("g2g-signature") || "",
    });

    if (!ok) {
      res.status(401).json({ error: "Invalid G2G webhook signature" });
      return;
    }

    next();
  };
}
