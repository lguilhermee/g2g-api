import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  decodeWebJwtClaims,
  isWebJwtExpired,
  normalizeWebJwt,
  signG2GOpenApiRequest,
} from "../src/auth.js";

test("signG2GOpenApiRequest computes canonical HMAC-SHA256 without query string", () => {
  const apiKey = "test-api-key";
  const apiSecret = "super-secret-key";
  const userId = "123456";
  const timestamp = "1730000000000";

  const headers = signG2GOpenApiRequest({
    urlPath: "/v2/services/svc-1/brands?language=en&q=test",
    apiKey,
    apiSecret,
    userId,
    timestamp,
  });

  const expected = crypto
    .createHmac("sha256", apiSecret)
    .update(`/v2/services/svc-1/brands${apiKey}${userId}${timestamp}`)
    .digest("hex");

  assert.equal(headers["g2g-api-key"], apiKey);
  assert.equal(headers["g2g-userid"], userId);
  assert.equal(headers["g2g-timestamp"], timestamp);
  assert.equal(headers["g2g-signature"], expected);
});

test("normalizeWebJwt strips optional Bearer prefix", () => {
  assert.equal(normalizeWebJwt("Bearer eyJ.abc.def"), "eyJ.abc.def");
  assert.equal(normalizeWebJwt("  bearer   eyJ.abc.def "), "eyJ.abc.def");
  assert.equal(normalizeWebJwt("eyJ.abc.def"), "eyJ.abc.def");
});

test("decodeWebJwtClaims and isWebJwtExpired decode standard JWT payloads", () => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ user_id: "123456", exp: Math.floor(Date.now() / 1000) + 3600 })
  ).toString("base64url");
  const token = `${header}.${payload}.sig`;

  const claims = decodeWebJwtClaims(token);
  assert.equal(claims?.user_id, "123456");
  assert.equal(isWebJwtExpired(token, 60), false);
  assert.equal(isWebJwtExpired(token, 7200), true);
});
